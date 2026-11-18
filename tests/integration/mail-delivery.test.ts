import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { closeDatabase, mailerDatabase } from "../../src/server/db/client";

const denied = { code: "42501" };

test("the mail delivery login has the narrowest possible access, and no other login can read the SMTP secret", async (t) => {
  const { TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL, TEST_MEDIA_DATABASE_URL, TEST_MAILER_DATABASE_URL, IDENTITY_DATABASE_URL } = process.env;
  assert.ok(TEST_DATABASE_URL && TEST_MIGRATION_DATABASE_URL && TEST_MEDIA_DATABASE_URL && TEST_MAILER_DATABASE_URL && IDENTITY_DATABASE_URL);
  const owner = new Pool({ connectionString: TEST_MIGRATION_DATABASE_URL });
  const mailer = new Pool({ connectionString: TEST_MAILER_DATABASE_URL });
  const runtime = new Pool({ connectionString: TEST_DATABASE_URL });
  const identity = new Pool({ connectionString: IDENTITY_DATABASE_URL });
  const worker = new Pool({ connectionString: TEST_MEDIA_DATABASE_URL });
  const runs: string[] = [];
  t.after(async () => {
    try {
      if (runs.length) await owner.query("delete from public.platform_jobs where id = any($1::uuid[])", [runs]);
    } finally { await Promise.all([owner.end(), mailer.end(), runtime.end(), identity.end(), worker.end(), closeDatabase()]); }
  });

  await t.test("it is a plain, restricted login in its own group", async () => {
    const { rows: [login] } = await mailer.query(`select current_user as name,
      pg_has_role(current_user, 'storefront_mailer', 'USAGE') as mailer,
      pg_has_role(current_user, 'storefront_app', 'MEMBER') as app,
      pg_has_role(current_user, 'storefront_identity', 'MEMBER') as identity,
      pg_has_role(current_user, 'storefront_media_worker', 'MEMBER') as worker,
      (select rolsuper or rolbypassrls or rolcreaterole from pg_roles where rolname = current_user) as privileged`);
    assert.deepEqual({ ...login, name: undefined }, { name: undefined, mailer: true, app: false, identity: false, worker: false, privileged: false });
  });

  await t.test("it has no table access: not the SMTP table, accounts, stores, the queue, or billing", async () => {
    for (const table of ["platform_mail", "platform_contact", "users", "sessions", "stores", "ops_notifications", "billing_requests", "platform_jobs", "platform_events"]) {
      await assert.rejects(mailer.query(`select 1 from public.${table} limit 1`), denied, table);
    }
    await assert.rejects(mailer.query("update public.platform_mail set enabled = false"), denied);
    await assert.rejects(mailer.query("delete from public.ops_notifications"), denied);
  });

  await t.test("it cannot call identity, platform administration, billing, maintenance or generic job functions", async () => {
    for (const statement of [
      "select * from platform_mail_secret()", "select platform_mail_view('x')", "select platform_job_start('media')",
      "select platform_job_finish(gen_random_uuid(), true, '{}'::jsonb)", "select billing_expire(1)", "select ops_maintain()",
      "select * from ops_missed_jobs()", "select * from catalog_claim_image_cleanup(1)", "select order_expire_intents(1)",
    ]) await assert.rejects(mailer.query(statement), denied, statement);
  });

  await t.test("it can run exactly the notification queue, read the public contact number and log its own job", async () => {
    await mailer.query("select ops_schedule_reminders()");
    // Claiming always leases at least one real notification, so the privilege is checked without calling the function.
    for (const signature of ["ops_claim_mail(integer)", "ops_finish_mail(uuid,uuid,text)", "ops_schedule_reminders()", "ops_mail_secret()", "ops_mail_job_start()"]) {
      assert.equal((await mailer.query("select has_function_privilege(current_user, $1, 'execute') as allowed", [`public.${signature}`])).rows[0].allowed, true, signature);
    }
    const { rows: [contact] } = await mailer.query("select platform_contact_public() as value");
    assert.match(contact.value.whatsapp, /^[1-9][0-9]{7,14}$/);
    const { rows: [started] } = await mailer.query("select ops_mail_job_start() as id");
    assert.ok(started.id);
    runs.push(started.id);
    assert.equal((await owner.query("select job, finished_at from public.platform_jobs where id = $1", [started.id])).rows[0].job, "notifications");
    await mailer.query("select ops_mail_job_finish($1, true, '{\"sent\":0}'::jsonb)", [started.id]);
    const { rows: [finished] } = await owner.query("select success, finished_at is not null as done from public.platform_jobs where id = $1", [started.id]);
    assert.deepEqual(finished, { success: true, done: true });
  });

  await t.test("it cannot close another job's run record", async () => {
    const { rows: [media] } = await owner.query("insert into public.platform_jobs(job) values ('media') returning id");
    runs.push(media.id);
    await mailer.query("select ops_mail_job_finish($1, true, '{}'::jsonb)", [media.id]);
    const { rows: [after] } = await owner.query("select finished_at from public.platform_jobs where id = $1", [media.id]);
    assert.equal(after.finished_at, null, "a notifications login must not finish a media run");
  });

  await t.test("no other login can read the SMTP secret, and the media worker no longer runs the queue", async () => {
    for (const [name, pool] of [["runtime", runtime], ["identity", identity], ["media worker", worker]] as const) {
      await assert.rejects(pool.query("select * from ops_mail_secret()"), denied, name);
      await assert.rejects(pool.query("select ops_mail_job_start()"), denied, name);
    }
    for (const signature of ["ops_schedule_reminders()", "ops_claim_mail(integer)", "ops_finish_mail(uuid,uuid,text)"]) {
      for (const [name, pool] of [["media worker", worker], ["runtime", runtime], ["identity", identity]] as const) {
        assert.equal((await pool.query("select has_function_privilege(current_user, $1, 'execute') as allowed", [`public.${signature}`])).rows[0].allowed, false, `${name} ${signature}`);
      }
    }
    // The identity login keeps its existing path for the app's own mail.
    await identity.query("select * from platform_mail_secret()");
  });

  await t.test("the application refuses a mail delivery login that could do more, and accepts the restricted one", async () => {
    const previous = process.env.MAIL_WORKER_DATABASE_URL;
    try {
      await closeDatabase();
      process.env.MAIL_WORKER_DATABASE_URL = TEST_MAILER_DATABASE_URL;
      assert.ok(await mailerDatabase());
      await closeDatabase();
      // The schema owner and the media worker are not the mail delivery role.
      for (const url of [TEST_MIGRATION_DATABASE_URL, TEST_MEDIA_DATABASE_URL, TEST_DATABASE_URL, IDENTITY_DATABASE_URL]) {
        process.env.MAIL_WORKER_DATABASE_URL = url;
        await assert.rejects(mailerDatabase(), /restricted mail delivery role/);
        await closeDatabase();
      }
    } finally {
      if (previous === undefined) delete process.env.MAIL_WORKER_DATABASE_URL; else process.env.MAIL_WORKER_DATABASE_URL = previous;
      await closeDatabase();
    }
  });
});
