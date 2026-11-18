import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { catalogStorage } from "../src/server/catalog/storage";
import { reportOperationalError } from "../src/server/ops/report";
import { sendOperationsMail, type OperationMailKind } from "../src/server/auth/mail";
import type { PoolClient } from "pg";

async function clean() {
  loadEnvConfig(process.cwd());
  // The notification queue runs as the dedicated mail delivery login (storefront_mailer): it holds the SMTP key and
  // can read the SMTP secret, and nothing else. Every other job keeps the media worker login and never sees mail secrets.
  const mailer = process.argv.includes("--notifications");
  const url = mailer ? process.env.MAIL_WORKER_DATABASE_URL : process.env.MEDIA_WORKER_DATABASE_URL;
  if (!url) throw new Error(`${mailer ? "MAIL_WORKER_DATABASE_URL" : "MEDIA_WORKER_DATABASE_URL"} is required.`);
  const db = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5_000 });
  const job = process.argv.includes("--inspect") ? "inspect" : process.argv.includes("--notifications") ? "notifications" :
    process.argv.includes("--maintenance") ? "maintenance" : process.argv.includes("--billing") ? "billing" :
      process.argv.includes("--orders") ? "orders" : "media";
  let lock: PoolClient | undefined;
  let run: string | undefined;
  let success = false;
  let counts: Record<string, number> = {};
  try {
    const { rows: [role] } = await db.query<{ allowed: boolean }>(mailer ? `
      select current_user = session_user and pg_has_role(current_user, 'storefront_mailer', 'USAGE')
        and not pg_has_role(current_user, 'storefront_app', 'MEMBER')
        and not pg_has_role(current_user, 'storefront_identity', 'MEMBER')
        and not pg_has_role(current_user, 'storefront_media_worker', 'MEMBER')
        and not exists (select 1 from pg_roles r where (r.rolsuper or r.rolbypassrls or r.rolcreaterole)
          and pg_has_role(session_user, r.oid, 'MEMBER'))
        and not has_table_privilege(session_user, 'public.platform_mail', 'SELECT')
        and not has_table_privilege(session_user, 'public.users', 'SELECT') as allowed
    ` : `
      select current_user = session_user and pg_has_role(current_user, 'storefront_media_worker', 'USAGE')
        and not pg_has_role(current_user, 'storefront_app', 'MEMBER')
        and not pg_has_role(current_user, 'storefront_identity', 'MEMBER')
        and not exists (select 1 from pg_roles r where (r.rolsuper or r.rolbypassrls or r.rolcreaterole)
          and pg_has_role(session_user, r.oid, 'MEMBER'))
        and not exists (select 1 from pg_class c where c.oid in ('public.catalog_images'::regclass, 'public.billing_requests'::regclass)
          and pg_has_role(session_user, c.relowner, 'MEMBER')) as allowed
    `);
    if (!role?.allowed) throw new Error(mailer ? "Notifications require the restricted mail delivery login." : "Cleanup requires the restricted media worker login.");
    if (job === "inspect") {
      const { rows } = await db.query<{ job: string }>("select * from public.ops_missed_jobs()");
      for (const row of rows) await reportOperationalError("worker_missed", row.job);
      success = true;
      return;
    }
    lock = await db.connect();
    const { rows: [mutex] } = await lock.query<{ held: boolean }>("select pg_try_advisory_lock(hashtextextended($1,9861)) as held", [job]);
    if (!mutex?.held) {
      console.log(JSON.stringify({ event: "job_already_running", job }));
      success = true;
      return;
    }
    run = (await (mailer ? db.query<{ id: string }>("select public.ops_mail_job_start() as id")
      : db.query<{ id: string }>("select public.platform_job_start($1) as id", [job]))).rows[0]?.id;
    if (!run) throw new Error("Worker start was not recorded.");
    if (job === "billing") {
      const { rows: [result] } = await db.query<{ counts: { requests: number; subscriptions: number; proofs: number } }>(
        "select public.billing_expire(1000) as counts");
      counts = result.counts;
      console.log("Billing expiry:", counts);
      success = true;
      return;
    }
    if (job === "maintenance") {
      const { rows: [result] } = await db.query<{ counts: Record<string, number> }>("select public.ops_maintain() as counts");
      counts = result.counts;
      success = counts.audit_mismatch === 0 && counts.abandoned === 0;
      if (!success) process.exitCode = 1;
      return;
    }
    if (job === "notifications") {
      counts = { enqueued: (await db.query<{ added: number }>("select public.ops_schedule_reminders() as added")).rows[0].added,
        sent: 0, retry: 0, terminal: 0, skipped: 0 };
      const { rows } = await db.query<{ id: string; kind: OperationMailKind; email: string | null; lease: string; slug: string | null }>(
        "select * from public.ops_claim_mail(12)");
      for (const row of rows) {
        const outcome = row.email ? await sendOperationsMail(process.env.OPS_MAIL_LOCALE === "en" ? "en" : "ar", row.email, row.kind, row.id, row.slug)
          .catch(() => "retry" as const) : "skipped";
        await db.query("select public.ops_finish_mail($1,$2,$3)", [row.id, row.lease, outcome]);
        counts[outcome]++;
      }
      success = counts.retry === 0 && counts.terminal === 0;
      if (!success) {
        process.exitCode = 1;
        await reportOperationalError("identity_mail_failed", "notifications");
      }
      return;
    }
    if (job === "orders") {
      const { rows: [result] } = await db.query<{ removed: number }>("select public.order_expire_intents(1000) as removed");
      console.log(`Order retention cleanup: ${result.removed} expired intents removed.`);
      counts = { removed: result.removed };
      success = true;
      return;
    }
    const storage = catalogStorage();
    const { rows } = await db.query<{ object_key: string }>("select * from public.catalog_claim_image_cleanup($1)", [20]);
    const results = await Promise.allSettled(rows.map(async ({ object_key }) => {
      await storage.remove(object_key);
      await db.query("select public.catalog_ack_image_cleanup($1)", [object_key]);
    }));
    const failed = results.filter((result) => result.status === "rejected").length;
    counts = { completed: results.length - failed, retry: failed };
    success = failed === 0;
    console.log(`Catalog media cleanup: ${results.length - failed} completed, ${failed} scheduled for retry.`);
    if (failed) process.exitCode = 1;
  } finally {
    try {
      if (run) await db.query(mailer ? "select public.ops_mail_job_finish($1,$2,$3::jsonb)" : "select public.platform_job_finish($1,$2,$3::jsonb)", [run, success, JSON.stringify(counts)]);
      if (!success) await reportOperationalError(job === "billing" ? "subscription_failed" : "worker_failed", job);
      if (run) console.log(JSON.stringify({ event: "job_finished", job, run, success, counts }));
    } finally {
      // Destroy the dedicated session so the advisory lock is released even on a failed job.
      lock?.release(true);
      await db.end();
    }
  }
}

clean().catch(() => {
  console.error("Catalog media cleanup could not run. Check the worker role and storage configuration.");
  process.exitCode = 1;
});
