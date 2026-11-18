import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { getSessionUser, register } from "../../src/server/auth/repository";
import { trialForStore } from "../../src/server/billing/repository";
import { closeDatabase } from "../../src/server/db/client";
import { createStore, getMemberStore } from "../../src/server/stores/repository";

test("notification claims, retries and acknowledgements are isolated and idempotent", async (t) => {
  const { TEST_DATABASE_URL, TEST_MIGRATION_DATABASE_URL, TEST_MEDIA_DATABASE_URL, TEST_MAILER_DATABASE_URL } = process.env;
  assert.ok(TEST_DATABASE_URL && TEST_MIGRATION_DATABASE_URL && TEST_MEDIA_DATABASE_URL && TEST_MAILER_DATABASE_URL);
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const owner = new Pool({ connectionString: TEST_MIGRATION_DATABASE_URL });
  const worker = new Pool({ connectionString: TEST_MEDIA_DATABASE_URL });
  const mailer = new Pool({ connectionString: TEST_MAILER_DATABASE_URL });
  const runtime = new Pool({ connectionString: TEST_DATABASE_URL });
  const slug = `ops-${randomUUID()}`;
  const email = `${slug}@example.test`;
  const fixture: { userId?: string; storeId?: string } = {};
  t.after(async () => {
    try {
      const { storeId, userId } = fixture;
      if (storeId) {
        await owner.query("delete from billing_audit where store_id=$1", [storeId]);
        await owner.query("delete from billing_trials where store_id=$1", [storeId]);
        await owner.query("delete from billing_subscriptions where store_id=$1", [storeId]);
        await owner.query("delete from stores where id=$1", [storeId]);
      }
      if (userId) {
        await owner.query("delete from billing_verified_accounts where user_id=$1", [userId]);
        await owner.query("delete from users where id=$1", [userId]);
      }
    } finally { await Promise.all([owner.end(), worker.end(), mailer.end(), runtime.end(), closeDatabase()]); }
  });
  const session = await register("Operations test", email, "synthetic operations password");
  assert.ok(session);
  const user = await getSessionUser(session.token);
  assert.ok(user);
  const userId = fixture.userId = user.id;
  await owner.query("insert into billing_verified_accounts(user_id,email) values ($1,$2)", [userId, email]);
  assert.ok(await createStore(userId, { slug, name: "Operations fixture", country: "PS", currency: "USD" }));
  const storeId = fixture.storeId = (await getMemberStore(userId, slug))?.id;
  assert.ok(storeId);
  assert.equal(await trialForStore(userId, slug), "ok");
  await owner.query("update billing_trials set ends_at=now()+interval '1 day' where store_id=$1", [storeId]);
  await assert.rejects(runtime.query("select * from ops_claim_mail(1)"), { code: "42501" });
  await assert.rejects(worker.query("select * from ops_notifications"), { code: "42501" });
  // The queue belongs to the mail delivery login. The media worker no longer runs it.
  for (const statement of ["select ops_schedule_reminders()", "select * from ops_claim_mail(1)", "select ops_finish_mail(gen_random_uuid(), gen_random_uuid(), 'sent')"]) {
    await assert.rejects(worker.query(statement), { code: "42501" });
  }
  await mailer.query("select ops_schedule_reminders()");
  await mailer.query("select ops_schedule_reminders()");
  const notices = await owner.query("select id from ops_notifications where subject=$1 and recipient=$2", [storeId, userId]);
  assert.equal(notices.rowCount, 1);
  const { id } = notices.rows[0];
  // Give this fixture priority over notices left by earlier local verification runs.
  const makeDue = () => owner.query("update ops_notifications set due_at='-infinity'::timestamptz where id=$1", [id]);
  const claim = async () => (await mailer.query("select * from ops_claim_mail(1)")).rows[0];
  const finish = async (lease: string, outcome: string) => (await mailer.query("select ops_finish_mail($1,$2,$3) as ok", [id, lease, outcome])).rows[0].ok;
  await makeDue();
  const first = await claim();
  assert.equal(first.id, id);
  assert.equal(first.email, email);
  assert.equal(first.slug, slug);
  assert.equal(await finish(first.lease, "retry"), true);
  assert.equal((await owner.query("select attempts, due_at>now() as deferred from ops_notifications where id=$1", [id])).rows[0].deferred, true);
  assert.equal(await finish(first.lease, "sent"), null);
  await makeDue();
  const second = await claim();
  assert.equal(second.id, id);
  assert.notEqual(second.lease, first.lease);
  assert.equal(await finish(second.lease, "sent"), true);
  assert.equal(await finish(second.lease, "sent"), null);
});
