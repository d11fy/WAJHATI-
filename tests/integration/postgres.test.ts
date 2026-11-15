import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { digest } from "../../src/server/auth/crypto";
import { allowAuthAttempt, authenticate, getSessionUser, register, revokeSession } from "../../src/server/auth/repository";
import { closeDatabase, database } from "../../src/server/db/client";
import { createStore, getMemberStore, getPublicStore, listMemberStores } from "../../src/server/stores/repository";
import { markLegacy } from "../fixtures/legacy.mjs";

test("PostgreSQL Foundation on a disposable migrated database", async (t) => {
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  assert.ok(runtimeUrl && ownerUrl, "Set TEST_DATABASE_URL and TEST_MIGRATION_DATABASE_URL for a disposable migrated database.");
  assert.equal(new URL(runtimeUrl).pathname, new URL(ownerUrl).pathname);
  process.env.DATABASE_URL = runtimeUrl;
  const runtime = new Pool({ connectionString: runtimeUrl, max: 1 });
  const owner = new Pool({ connectionString: ownerUrl });
  const prefix = `test-${randomUUID()}`;
  const aliceEmail = `${prefix}-alice@example.test`;
  const bobEmail = `${prefix}-bob@example.test`;
  const password = "strong testing password";
  const slug = `${prefix}-a`;
  const otherSlug = `${prefix}-b`;
  const raceSlug = `${prefix}-race`;
  const rollbackSlug = `${prefix}-fail`;
  const input = { name: "دار الزيتون", slug, country: "PS", currency: "JOD" } as const;

  t.after(async () => {
    try {
      await owner.query("delete from public.ops_notifications where recipient in (select id from public.users where email = any($1))", [[aliceEmail, bobEmail]]);
      await owner.query("delete from public.billing_audit where store_id in (select id from public.stores where slug = any($1)) or actor_id in (select id from public.users where email = any($2))", [[slug, otherSlug, raceSlug, rollbackSlug], [aliceEmail, bobEmail]]);
      await owner.query("delete from public.billing_trials where store_id in (select id from public.stores where slug = any($1)) or user_id in (select id from public.users where email = any($2))", [[slug, otherSlug, raceSlug, rollbackSlug], [aliceEmail, bobEmail]]);
      await owner.query("delete from public.billing_subscriptions where store_id in (select id from public.stores where slug = any($1))", [[slug, otherSlug, raceSlug, rollbackSlug]]);
      await owner.query("delete from public.stores where slug = any($1)", [[slug, otherSlug, raceSlug, rollbackSlug]]);
      await owner.query("delete from public.users where email = any($1)", [[aliceEmail, bobEmail]]);
      await owner.query("delete from public.auth_limits where key = $1", [digest(`sign-in:email:${aliceEmail}`)]);
    } finally {
      await Promise.all([runtime.end(), owner.end(), closeDatabase()]);
    }
  });

  const alice = await register("Alice", aliceEmail, password);
  const bob = await register("Bob", bobEmail, password);
  assert.ok(alice && bob);
  const aliceUser = await getSessionUser(alice.token);
  const bobUser = await getSessionUser(bob.token);
  assert.ok(aliceUser && bobUser);

  await t.test("stores only digested tokens and rotates, expires and revokes sessions", async () => {
    assert.equal(await register("Other", aliceEmail, password), null);
    assert.equal(await authenticate(aliceEmail, "incorrect password"), null);
    assert.equal(await authenticate(`${prefix}@example.test`, password), null);
    const { rows } = await owner.query("select token_hash from public.sessions where user_id = $1", [aliceUser.id]);
    assert.deepEqual(rows, [{ token_hash: digest(alice.token) }]);
    const rotated = await authenticate(aliceEmail, password, alice.token);
    assert.ok(rotated);
    assert.equal(await getSessionUser(alice.token), null);
    assert.equal((await getSessionUser(rotated.token))?.id, aliceUser.id);
    await owner.query("update public.sessions set expires_at = now() where token_hash = $1", [digest(rotated.token)]);
    assert.equal(await getSessionUser(rotated.token), null);
    const fresh = await authenticate(aliceEmail, password);
    assert.ok(fresh);
    await revokeSession(fresh.token);
    assert.equal(await getSessionUser(fresh.token), null);
  });

  await t.test("enforces the attempt cap under parallel requests and resets it after expiry", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => allowAuthAttempt("sign-in", aliceEmail)));
    assert.equal(results.filter(Boolean).length, 8);
    await owner.query("update public.auth_limits set expires_at = now() where key = $1", [digest(`sign-in:email:${aliceEmail}`)]);
    assert.ok(await allowAuthAttempt("sign-in", aliceEmail));
  });

  await t.test("scopes private access to current memberships and removes access on revocation", async () => {
    assert.ok(await createStore(aliceUser.id, input));
    assert.ok(await createStore(bobUser.id, { ...input, slug: otherSlug }));
    const own = await getMemberStore(aliceUser.id, slug);
    assert.equal(own?.role, "owner");
    assert.equal(await getMemberStore(bobUser.id, slug), null);
    assert.equal(await getMemberStore(aliceUser.id, otherSlug), null);
    assert.deepEqual((await listMemberStores(bobUser.id)).map((store) => store.slug), [otherSlug]);

    await owner.query("insert into public.store_memberships (store_id, user_id, role) values ($1, $2, 'staff')", [own?.id, bobUser.id]);
    assert.equal((await getMemberStore(bobUser.id, slug))?.role, "staff");
    await owner.query("delete from public.store_memberships where store_id = $1 and user_id = $2", [own?.id, bobUser.id]);
    assert.equal(await getMemberStore(bobUser.id, slug), null);
  });

  await t.test("denies unscoped database reads and direct writes under the runtime login", async () => {
    assert.equal((await runtime.query("select id from public.stores")).rowCount, 0);
    assert.equal((await runtime.query("select user_id from public.store_memberships")).rowCount, 0);
    const conn = await runtime.connect();
    try {
      await conn.query("begin");
      await conn.query("select set_config('dar.user_id', $1, true)", [aliceUser.id]);
      assert.deepEqual((await conn.query("select slug from public.stores")).rows, [{ slug }]);
      assert.deepEqual((await conn.query("select user_id from public.store_memberships")).rows, [{ user_id: aliceUser.id }]);
    } finally {
      await conn.query("rollback");
      conn.release();
    }
    assert.equal((await runtime.query("select id from public.stores")).rowCount, 0);
    await assert.rejects(runtime.query("update public.stores set name = 'forbidden'"), { code: "42501" });
    await assert.rejects(runtime.query("delete from public.store_memberships"), { code: "42501" });
    await assert.rejects(runtime.query("select public.create_store('No actor', 'no-actor', 'PS', 'JOD')"), { code: "42501" });
  });

  await t.test("new stores are drafts and remain accessible to their members", async () => {
    assert.equal(await getPublicStore(slug), null);
    assert.equal((await getMemberStore(aliceUser.id, slug))?.published, false);
    await owner.query("delete from public.billing_trials where store_id in (select id from public.stores where slug = $1)", [slug]);
    await assert.rejects(owner.query("update public.stores set published_at = now() where slug = $1", [slug]), { constraint: "billing_publication" });
    assert.equal(await getPublicStore(slug), null);
    assert.equal((await getMemberStore(aliceUser.id, slug))?.published, false);
    await markLegacy(owner, slug);
    await owner.query("update public.stores set published_at = now() where slug = $1", [slug]);
    assert.equal(await getPublicStore(slug), null);
    assert.equal((await getMemberStore(aliceUser.id, slug))?.published, true);
  });

  await t.test("allocates a slug once and rolls back if ownership cannot be created", async () => {
    const results = await Promise.all([aliceUser.id, bobUser.id].map((id) => createStore(id, { ...input, slug: raceSlug })));
    assert.equal(results.filter(Boolean).length, 1);
    const { rows } = await owner.query("select m.role from public.store_memberships m join public.stores s on s.id = m.store_id where s.slug = $1", [raceSlug]);
    assert.deepEqual(rows, [{ role: "owner" }]);
    await assert.rejects(createStore(randomUUID(), { ...input, slug: rollbackSlug }));
    assert.equal((await owner.query("select id from public.stores where slug = $1", [rollbackSlug])).rowCount, 0);
  });

  await t.test("refuses to start tenant data access with the schema owner credentials", async () => {
    await closeDatabase();
    process.env.DATABASE_URL = ownerUrl;
    await assert.rejects(database(), /restricted runtime role/);
  });

  if (process.env.TEST_BYPASS_DATABASE_URL) {
    await t.test("refuses a login that can assume a role with BYPASSRLS", async () => {
      await closeDatabase();
      process.env.DATABASE_URL = process.env.TEST_BYPASS_DATABASE_URL;
      await assert.rejects(database(), /restricted runtime role/);
    });
  }
});
