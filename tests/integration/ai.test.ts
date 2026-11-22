import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { getSessionUser, register } from "../../src/server/auth/repository";
import { trialForStore } from "../../src/server/billing/repository";
import { closeDatabase } from "../../src/server/db/client";
import { aiAdminAdjust, aiAdminConfigure, aiAdminOverview } from "../../src/server/ai/admin";
import { mockProvider, ProviderError, setAiProviderForTests } from "../../src/server/ai/provider";
import { runAssist, runThemeFill } from "../../src/server/ai/service";
import { getWallet } from "../../src/server/ai/wallet";
import { readAiWallet } from "../../src/server/ai/wallet-view";
import { createStore, getMemberStore } from "../../src/server/stores/repository";

test("AI credits on migrated PostgreSQL: cycles, atomic reservations, isolation, ledger and admin controls", async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  assert.ok(url && ownerUrl);
  process.env.DATABASE_URL = url;
  process.env.DAR_ENV = "development";
  const owner = new Pool({ connectionString: ownerUrl });
  const runtime = new Pool({ connectionString: url });
  const prefix = `ai-${randomUUID().slice(0, 8)}`;
  const slugs = Object.fromEntries(["trial", "extra", "paid", "yearly", "old", "ended", "iso", "load"].map((name) => [name, `${prefix}-${name}`])) as Record<string, string>;
  const emails = ["alice", "bob", "root"].map((name) => `${prefix}-${name}@example.test`);
  const ids: string[] = [];
  const { rows: [original] } = await owner.query("select per_minute, per_day, enabled, monthly_credits, trial_credits from public.ai_settings where id = 1");
  await owner.query("update public.ai_settings set per_minute = 600, per_day = 100000");
  t.after(async () => {
    try {
      setAiProviderForTests(undefined);
      await owner.query("update public.ai_settings set per_minute = $1, per_day = $2, enabled = $3, monthly_credits = $4, trial_credits = $5 where id = 1",
        [original.per_minute, original.per_day, original.enabled, original.monthly_credits, original.trial_credits]);
      await owner.query("delete from public.ai_store_controls where store_id = any($1)", [ids]);
      const cleanup = await owner.connect();
      try {
        await cleanup.query("select set_config('dar.cleanup', 'on', false)");
        for (const table of ["platform_manual_terms", "billing_audit", "billing_trials", "billing_subscriptions"]) await cleanup.query(`delete from public.${table} where store_id = any($1)`, [ids]);
      } finally { cleanup.release(true); }
      await owner.query("delete from public.ops_notifications where recipient in (select id from public.users where email = any($1))", [emails]);
      await owner.query("delete from public.stores where id = any($1)", [ids]);
      await owner.query("delete from public.billing_verified_accounts where email = any($1)", [emails]);
      await owner.query("delete from public.users where email = any($1)", [emails]);
    } finally { await Promise.all([owner.end(), runtime.end(), closeDatabase()]); }
  });

  const people = await Promise.all(emails.map(async (email) => {
    const session = await register("AI tester", email, "ai integration password");
    assert.ok(session);
    const user = await getSessionUser(session.token);
    assert.ok(user);
    return { ...user, token: session.token };
  }));
  const [alice, bob, root] = people;
  for (const user of [alice, root]) await owner.query("insert into public.billing_verified_accounts(user_id,email) values ($1,$2) on conflict do nothing", [user.id, user.email]);
  for (const [name, user] of [["trial", alice], ["extra", alice], ["paid", alice], ["yearly", alice], ["old", alice], ["ended", alice], ["iso", bob], ["load", alice]] as const) {
    assert.ok(await createStore(user.id, { slug: slugs[name], name: "متجر الذكاء", country: "JO", currency: "JOD" }));
    const store = await getMemberStore(user.id, slugs[name]);
    assert.ok(store);
    ids.push(store.id);
  }
  const storeId = (name: string) => ids[Object.keys(slugs).indexOf(name)];
  const { rows: [plan] } = await owner.query<{ id: string }>("select id from public.billing_plans where code = 'pro' and version = 1");
  async function subscribe(name: string, startedDaysAgo: number, months: number) {
    await owner.query("delete from public.billing_trials where store_id = $1", [storeId(name)]);
    await owner.query(`insert into public.platform_manual_terms(id,store_id,plan_id,months,amount_minor,currency,reference,actor,approved_by,starts_at,ends_at)
      values ($1,$2,$3,$4,1000,'JOD',$5,$6,$6, now() - make_interval(days => $7), now() - make_interval(days => $7) + make_interval(months => $4))`,
    [randomUUID(), storeId(name), plan.id, months, `${prefix}-${name}-${randomUUID().slice(0, 6)}`, root.id, startedDaysAgo]);
  }
  const wallet = async (name: string, user = alice) => (await getWallet(user.id, slugs[name]))?.wallet;
  const ledger = async (name: string) => (await owner.query("select kind, delta, balance_after, extra_after from public.ai_ledger where store_id = $1 order by id", [storeId(name)])).rows;
  const fill = (name: string, idea = "متجر قهوة مختصة") => runThemeFill(alice.id, slugs[name], {
    theme: "minimal-commerce", idea, businessType: "", audience: "", tone: "professional", languages: "ar", useStoreData: false, key: randomUUID(),
  });
  const assist = (name: string, text = "قهوة", user = alice) => runAssist(user.id, slugs[name], {
    fieldId: "product.nameAr", command: "improve", text, key: randomUUID(),
  });
  setAiProviderForTests(mockProvider());

  await t.test("a trial gets the free allocation once per account, never for an extra store", async () => {
    assert.equal(await trialForStore(alice.id, slugs.trial), "ok");
    const first = await wallet("trial");
    assert.ok(first);
    assert.deepEqual([first.balance, first.allocation, first.kind], [30, 30, "trial"]);
    assert.equal(await trialForStore(alice.id, slugs.extra), "ineligible");
    const second = await wallet("extra");
    assert.ok(second);
    assert.deepEqual([second.balance, second.kind], [0, null]);
    assert.deepEqual(await assist("extra"), { ok: false, error: "no_plan" });
    assert.equal((await wallet("trial"))?.balance, 30, "reading again never allocates twice");
    assert.equal((await ledger("trial")).filter((row) => row.kind === "allocation").length, 1);
  });

  await t.test("operation prices are charged on success and shown with the balance", async () => {
    const result = await assist("trial");
    assert.ok(result.ok);
    assert.equal(result.cost, 1);
    assert.equal((await wallet("trial"))?.balance, 29);
    const fillResult = await fill("trial");
    assert.ok(fillResult.ok);
    assert.equal(fillResult.cost, 20);
    assert.equal((await wallet("trial"))?.balance, 9);
    assert.deepEqual((await ledger("trial")).map((row) => row.kind), ["allocation", "reserve", "commit", "reserve", "commit"]);
    const { rows: [log] } = await owner.query("select status, input_tokens, output_tokens, est_cost_usd, provider, model, operation from public.ai_requests where store_id = $1 order by created_at limit 1", [storeId("trial")]);
    assert.equal(log.status, "succeeded");
    assert.ok(log.input_tokens > 0 && log.output_tokens > 0 && Number(log.est_cost_usd) > 0);
    assert.deepEqual([log.provider, log.operation], ["mock", "headline"]);
  });

  await t.test("insufficient balance never reaches the provider", async () => {
    let calls = 0;
    setAiProviderForTests(mockProvider(() => { calls++; return JSON.stringify({ options: ["x"] }); }));
    assert.deepEqual(await fill("trial"), { ok: false, error: "insufficient" });
    assert.equal(calls, 0);
    assert.equal((await wallet("trial"))?.balance, 9);
    setAiProviderForTests(mockProvider());
  });

  await t.test("provider failures and invalid output are released, not charged", async () => {
    setAiProviderForTests({ name: "mock", complete: async () => { throw new ProviderError("upstream", true); } });
    assert.deepEqual(await assist("trial"), { ok: false, error: "unavailable" });
    setAiProviderForTests(mockProvider(() => "not json"));
    assert.deepEqual(await assist("trial"), { ok: false, error: "bad_output" });
    setAiProviderForTests(mockProvider(() => JSON.stringify({ options: ["x".repeat(500)] })));
    assert.deepEqual(await assist("trial"), { ok: false, error: "bad_output" });
    assert.equal((await wallet("trial"))?.balance, 9);
    const { rows } = await owner.query("select status, error_code from public.ai_requests where store_id = $1 and status = 'failed' order by created_at", [storeId("trial")]);
    assert.deepEqual(rows.map((row) => row.error_code), ["upstream", "bad_output", "bad_output"]);
    setAiProviderForTests({ name: "mock", complete: async () => { throw new ProviderError("not_configured"); } });
    assert.deepEqual(await assist("trial"), { ok: false, error: "not_configured" });
    setAiProviderForTests(mockProvider());
  });

  await t.test("an idempotency key charges once", async () => {
    const body = { fieldId: "product.nameAr", command: "improve", text: "قهوة", key: randomUUID() };
    assert.ok((await runAssist(alice.id, slugs.trial, body)).ok);
    assert.deepEqual(await runAssist(alice.id, slugs.trial, body), { ok: false, error: "duplicate" });
    assert.equal((await wallet("trial"))?.balance, 8);
  });

  await t.test("paid periods grant 600 per monthly cycle, also for multi-month terms, without rollover", async () => {
    await subscribe("paid", 5, 1);
    const month = await wallet("paid");
    assert.ok(month);
    assert.deepEqual([month.balance, month.allocation, month.kind], [600, 600, "subscription"]);
    assert.ok(month.cycleEnd && new Date(month.cycleEnd) > new Date());
    await subscribe("yearly", 100, 12);
    const year = await wallet("yearly");
    assert.ok(year);
    assert.deepEqual([year.balance, year.allocation], [600, 600]);
    assert.ok(new Date(year.cycleEnd!).getTime() - Date.now() < 32 * 86_400_000, "the cycle is one month, not the whole term");
    await subscribe("old", 35, 3);
    const second = await getWallet(alice.id, slugs.old);
    assert.equal(second?.wallet?.balance, 600);
    const { rows: [allocation] } = await owner.query("select cycle_key, starts_at from public.ai_allocations where store_id = $1", [storeId("old")]);
    assert.match(allocation.cycle_key, /:1$/, "the second monthly window of the term");
  });

  await t.test("trial becomes paid: the unused trial remainder expires and 600 is allocated", async () => {
    await subscribe("trial", 0, 1);
    const upgraded = await wallet("trial");
    assert.deepEqual([upgraded?.balance, upgraded?.kind], [600, "subscription"]);
    const kinds = (await ledger("trial")).map((row) => row.kind);
    assert.ok(kinds.includes("expire"));
    assert.equal(kinds.at(-1), "allocation");
    assert.equal((await owner.query("select 1 from public.ai_trial_claims where store_id = $1", [storeId("trial")])).rowCount, 1);
  });

  await t.test("an ended subscription has no credits and the previous cycle is forfeited", async () => {
    await subscribe("ended", 10, 1);
    assert.equal((await wallet("ended"))?.balance, 600);
    const mutate = await owner.connect();
    try {
      await mutate.query("select set_config('dar.cleanup', 'on', false)");
      await mutate.query("update public.platform_manual_terms set starts_at = starts_at - interval '60 days', ends_at = ends_at - interval '60 days' where store_id = $1", [storeId("ended")]);
    } finally { mutate.release(true); }
    const after = await wallet("ended");
    assert.deepEqual([after?.balance, after?.kind], [0, null]);
    assert.ok((await ledger("ended")).some((row) => row.kind === "expire" && row.delta === -600));
    assert.deepEqual(await assist("ended"), { ok: false, error: "no_plan" });
  });

  await t.test("concurrent requests can never spend the same credits twice", async () => {
    await subscribe("load", 3, 1);
    assert.equal((await wallet("load"))?.balance, 600);
    const results = await Promise.all(Array.from({ length: 40 }, () => fill("load")));
    assert.equal(results.filter((result) => result.ok).length, 30);
    assert.equal(results.filter((result) => !result.ok && result.error === "insufficient").length, 10);
    const after = await wallet("load");
    assert.deepEqual([after?.balance, after?.extra], [0, 0]);
    const rows = await ledger("load");
    assert.equal(rows.reduce((sum, row) => sum + row.delta, 0), 0, "allocation minus reservations nets to the balance");
    assert.ok(rows.every((row) => row.balance_after >= 0));
  });

  await t.test("stale reservations are recovered and the credits return", async () => {
    await owner.query("update public.ai_settings set monthly_credits = 600 where id = 1");
    const key = randomUUID();
    const reserved = await getWallet(alice.id, slugs.paid);
    assert.ok(reserved?.wallet);
    const { withMerchantStore } = await import("../../src/server/stores/repository");
    const { reserveCredits } = await import("../../src/server/ai/wallet");
    const outcome = await withMerchantStore(alice.id, slugs.paid, false, (tx, store) => reserveCredits(tx, store.id, "store_from_idea", key));
    assert.equal(outcome?.status, "ok");
    assert.equal((await wallet("paid"))?.balance, 580);
    await owner.query("update public.ai_requests set expires_at = now() - interval '1 minute' where store_id = $1 and idempotency_key = $2", [storeId("paid"), key]);
    assert.equal((await wallet("paid"))?.balance, 600);
    const { rows: [request] } = await owner.query("select status from public.ai_requests where idempotency_key = $1", [key]);
    assert.equal(request.status, "expired");
  });

  await t.test("stores are isolated: no foreign wallet, no foreign reservation, no direct writes", async () => {
    assert.equal(await getWallet(bob.id, slugs.paid), null);
    assert.deepEqual(await assist("paid", "قهوة", bob), { ok: false, error: "denied" });
    assert.equal(await readAiWallet(bob.id, slugs.paid), null);
    assert.ok(await getWallet(bob.id, slugs.iso));
    const client = await runtime.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('dar.user_id', $1, true), set_config('dar.store_id', $2, true)", [bob.id, storeId("iso")]);
      assert.equal((await client.query("select 1 from public.ai_wallets where store_id = $1", [storeId("paid")])).rowCount, 0);
      assert.equal((await client.query("select 1 from public.ai_ledger where store_id = $1", [storeId("paid")])).rowCount, 0);
      assert.equal((await client.query("select public.ai_reserve($1, 'headline', $2)", [storeId("paid"), randomUUID()])).rows[0].ai_reserve.status, "denied");
      await client.query("rollback");
      for (const statement of [
        "update public.ai_wallets set balance = 100000", "insert into public.ai_ledger(store_id,kind,delta,balance_after,extra_after) values (gen_random_uuid(),'admin_grant',1,1,1)",
        "update public.ai_settings set enabled = false", "update public.ai_operation_costs set credits = 0", "delete from public.ai_requests",
      ]) {
        await client.query("begin");
        await assert.rejects(client.query(statement), /permission denied|row-level security/, statement);
        await client.query("rollback");
      }
    } finally { client.release(); }
  });

  await t.test("the ledger is append-only", async () => {
    await assert.rejects(owner.query("update public.ai_ledger set delta = 999 where store_id = $1", [storeId("paid")]), /append-only/);
    await assert.rejects(owner.query("delete from public.ai_ledger where store_id = $1", [storeId("paid")]), /append-only/);
  });

  await t.test("kill switch, per-store suspension and rate limits stop requests before the provider", async () => {
    let calls = 0;
    setAiProviderForTests(mockProvider(() => { calls++; return JSON.stringify({ options: ["اسم"] }); }));
    await owner.query("update public.ai_settings set enabled = false where id = 1");
    assert.deepEqual(await assist("paid"), { ok: false, error: "disabled" });
    await owner.query("update public.ai_settings set enabled = true where id = 1");
    await owner.query("insert into public.ai_store_controls(store_id,suspended) values ($1,true)", [storeId("paid")]);
    assert.deepEqual(await assist("paid"), { ok: false, error: "suspended" });
    await owner.query("update public.ai_store_controls set suspended = false where store_id = $1", [storeId("paid")]);
    await owner.query("update public.ai_settings set per_minute = 1 where id = 1");
    assert.ok((await assist("yearly")).ok);
    assert.deepEqual(await assist("yearly"), { ok: false, error: "rate_limited" });
    await owner.query("update public.ai_settings set per_minute = 600 where id = 1");
    assert.equal(calls, 1);
    setAiProviderForTests(mockProvider());
  });

  await t.test("administrators grant and withdraw credits with an audit trail; merchants cannot", async () => {
    await owner.query("insert into public.platform_roles(user_id,role) values ($1,'owner')", [root.id]);
    await owner.query("insert into public.platform_elevations(session_hash,verified_at) values (public.platform_hash($1), now())", [root.token]);
    assert.equal(await aiAdminAdjust(alice.token, slugs.paid, 50, "نقاط تعويضية"), "denied");
    assert.equal(await aiAdminOverview(alice.token), null);
    assert.equal(await aiAdminAdjust(root.token, slugs.paid, 50, "  "), "invalid");
    assert.equal(await aiAdminAdjust(root.token, slugs.paid, 50, "compensation"), "ok");
    const granted = await wallet("paid");
    assert.deepEqual([granted?.balance, granted?.extra], [600, 50]);
    assert.equal(await aiAdminAdjust(root.token, slugs.paid, -70, "correction"), "ok");
    const withdrawn = await wallet("paid");
    assert.deepEqual([withdrawn?.balance, withdrawn?.extra], [580, 0]);
    assert.equal(await aiAdminAdjust(root.token, "missing-store-slug", 5, "x-note"), "invalid");
    const rows = await ledger("paid");
    assert.deepEqual(rows.filter((row) => row.kind.startsWith("admin")).map((row) => row.delta), [50, -70]);
    const { rows: [audit] } = await owner.query("select count(*)::int as count from public.platform_events where action in ('ai_credit_grant','ai_credit_withdraw') and subject = $1", [storeId("paid")]);
    assert.equal(audit.count, 2);
    const overview = await aiAdminOverview(root.token);
    assert.ok(overview && overview.costs.length === 6 && overview.totals.requests > 0);
    assert.equal(await aiAdminConfigure(root.token, "cost", { operation: "headline", credits: 2, active: true }), "ok");
    assert.equal((await assist("paid")).ok && (await wallet("paid"))?.balance, 578);
    assert.equal(await aiAdminConfigure(root.token, "cost", { operation: "headline", credits: 1, active: true }), "ok");
    assert.equal(await aiAdminConfigure(root.token, "cost", { operation: "nonexistent", credits: 1, active: true }), "invalid");
    assert.equal(await aiAdminConfigure(root.token, "store_suspend", { slug: slugs.paid, suspended: true, reason: "abuse" }), "ok");
    assert.deepEqual(await assist("paid"), { ok: false, error: "suspended" });
    assert.equal(await aiAdminConfigure(root.token, "store_suspend", { slug: slugs.paid, suspended: false, reason: "" }), "ok");
    assert.equal(await aiAdminConfigure(alice.token, "settings", { enabled: true, perMinute: 6, perDay: 150, trialCredits: 30, monthlyCredits: 600, usdInput: 0.1, usdOutput: 0.2 }), "denied");
  });
});
