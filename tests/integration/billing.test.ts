import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import sharp from "sharp";
import { productInput } from "../../src/lib/catalog";
import { defaultDesign, switchTheme } from "../../src/lib/theme-config";
import { register, getSessionUser, revokeSession } from "../../src/server/auth/repository";
import { cancelAtEnd, createPaymentRequest, downloadProof, listPaymentReviews, mayReviewPayments, merchantBilling, reviewRequest, submitProof, trialForStore } from "../../src/server/billing/repository";
import { saveProduct, setStorePublication } from "../../src/server/catalog/merchant";
import { closeDatabase } from "../../src/server/db/client";
import { createStore, getMemberStore, getPublicStore, withMerchantStore } from "../../src/server/stores/repository";
import { publishDesign, saveDesign } from "../../src/server/themes/design";
import { getPublishedDesign } from "../../src/server/themes/public";
import { markLegacy } from "../fixtures/legacy.mjs";
import { makeEnrollment, markPlatform, otp } from "../fixtures/platform.mjs";
import { mfaSeed, mfaVerify } from "../../src/server/platform/repository";
import { grantManualSubscription } from "../../src/server/platform/contact";
import { addUtcCalendarMonths } from "../../src/lib/platform-contact";
import { marketingBilling } from "../../src/server/billing/marketing";

test("billing workflow with real PostgreSQL, restricted runtime and maintenance credentials", async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  const workerUrl = process.env.TEST_MEDIA_DATABASE_URL;
  assert.ok(url && ownerUrl && workerUrl);
  assert.equal(new URL(url).pathname, new URL(ownerUrl).pathname);
  assert.equal(new URL(url).pathname, new URL(workerUrl).pathname);
  process.env.DATABASE_URL = url;
  const owner = new Pool({ connectionString: ownerUrl });
  const runtime = new Pool({ connectionString: url });
  const worker = new Pool({ connectionString: workerUrl });
  const name = `bill-${randomUUID()}`;
  const [trialSlug, spareSlug, paidSlug, existingSlug] = ["a","b","c","d"].map((suffix) => `${name}-${suffix}`);
  const emails = ["trial","merchant","admin"].map((kind) => `${name}-${kind}@example.test`);
  const tenantIds: string[] = [];
  t.after(async () => {
    try {
      await owner.query("select set_config('dar.cleanup', 'on', false)");
      await owner.query("delete from public.ops_notifications where recipient in (select id from public.users where email = any($1))", [emails]);
      for (const table of ["platform_manual_terms", "billing_audit", "billing_setup_requests", "billing_reviews", "billing_proofs", "billing_periods", "billing_requests", "billing_trials", "billing_subscriptions"]) {
        await owner.query(`delete from public.${table} where store_id = any($1)`, [tenantIds]);
      }
      await owner.query("delete from public.stores where id = any($1)", [tenantIds]);
      await owner.query("delete from public.billing_admins where user_id in (select id from public.users where email = any($1))", [emails]);
      await owner.query("delete from public.billing_verified_accounts where email = any($1)", [emails]);
      await owner.query("delete from public.users where email = any($1)", [emails]);
    } finally { await Promise.all([owner.end(), runtime.end(), worker.end(), closeDatabase()]); }
  });
  const [trial, merchant, admin] = await Promise.all(emails.map(async (email) => {
    const session = await register("Billing tester", email, "long local billing password");
    assert.ok(session);
    const user = await getSessionUser(session.token);
    assert.ok(user);
    return { ...user, token: session.token };
  }));
  for (const [slug, user] of [[trialSlug, trial.id], [spareSlug, trial.id], [paidSlug, merchant.id], [existingSlug, merchant.id]]) {
    assert.ok(await createStore(user, { slug, name: "Billing test store", country: "PS", currency: "USD" }));
    const store = await getMemberStore(user, slug);
    assert.ok(store);
    tenantIds.push(store.id);
  }
  const [trialId,, paidId] = tenantIds;
  await owner.query("delete from public.ops_notifications where kind = 'trial_started' and \"window\" = $1", [paidId]);
  await owner.query("delete from public.billing_audit where event = 'trial_started' and store_id = $1", [paidId]);
  await owner.query("delete from public.billing_trials where store_id = $1", [paidId]);
  await owner.query("delete from public.billing_subscriptions where store_id = $1", [paidId]);
  await markLegacy(owner, existingSlug);
  for (const user of [trial, admin]) await owner.query("insert into public.billing_verified_accounts(user_id,email) values ($1,$2)", [user.id, user.email]);
  const enroll = makeEnrollment();
  await markPlatform(owner, admin.id, "reviewer", enroll);
  const seed = await mfaSeed(admin.token, enroll, false);
  assert.ok(seed);
  const stepped = await mfaVerify(admin.token, otp(Buffer.from(seed, "hex")));
  assert.ok(stepped);
  admin.token = stepped.token;
  const products = (slug: string, state: "draft" | "published" = "draft") => productInput.parse({
    slug, nameAr: "منتج اختبار", nameEn: "Test product", position: "0", descriptionAr: "", descriptionEn: "", price: "3.50", compareAt: "", sku: "",
    state, featured: false, available: true, categoryIds: [], options: "",
  });
  const price = { pro: "f6500000-40ce-4782-8038-000000000001", starter: "f6500000-40ce-4782-8038-000000000002",
    djf: "f6500000-40ce-4782-8038-000000000003", usd: "f6500000-40ce-4782-8038-000000000004" };
  const jodMethod = "f6500000-40ce-4782-8038-000000000011";
  const djfMethod = "f6500000-40ce-4782-8038-000000000012";
  const usdMethod = "f6500000-40ce-4782-8038-000000000013";
  const setup = "f6500000-40ce-4782-8038-000000000021";
  for (const [id, plan, country, currency, interval, amount] of [
    [price.pro, "pro", "JO", "JOD", "monthly", 12345], [price.starter, "starter", "JO", "JOD", "monthly", 6789],
    [price.djf, "starter", "DJ", "DJF", "yearly", 4500], [price.usd, "pro", "PS", "USD", "yearly", 19999],
  ]) await owner.query(`insert into public.billing_prices(id,plan_id,country,currency,interval,amount)
    select $1,id,$3,$4,$5,$6 from public.billing_plans where code=$2 and version=1
    on conflict (id) do update set active=true`, [id, plan, country, currency, interval, amount]);
  for (const [id, country, currency] of [[jodMethod, "JO", "JOD"], [djfMethod, "DJ", "DJF"], [usdMethod, "PS", "USD"]]) {
    await owner.query("insert into public.billing_methods values ($1,$2,$3,'Test reconciliation','Verify through independent fixture records',true) on conflict do nothing", [id, country, currency]);
  }
  await owner.query("insert into public.billing_setup_packages values ($1,'JO','JOD','Assisted launch',5000,true) on conflict do nothing", [setup]);

  await t.test("public pricing exposes active offers without payment instructions or tenant data", async () => {
    const result = await marketingBilling();
    assert.ok(result);
    const offer = result.offers.find(({ country, currency, plan, interval }) => country === "JO" && currency === "JOD" && plan === "pro" && interval === "monthly");
    assert.ok(offer);
    assert.equal(offer.amount, 12345);
    assert.deepEqual(Object.keys(offer).sort(), ["amount", "analytics", "country", "currency", "interval", "luxury", "maxProducts", "plan", "storageMiB"]);
    assert.ok(!JSON.stringify(result).includes("Verify through independent fixture records"));
    await assert.rejects(worker.query("select public.billing_marketing()"), { code: "42501" });
  });

  await t.test("published prices stay visible without payment methods while purchases remain unavailable", async () => {
    await owner.query("update public.billing_methods set active=false where id=$1", [usdMethod]);
    try {
      const result = await marketingBilling();
      const published = result?.catalog?.find((offer) => offer.country === "PS" && offer.currency === "USD" && offer.plan === "pro");
      assert.ok(published);
      assert.equal(published.amount, 19999);
      assert.equal(published.canPurchase, false);
      assert.equal(published.premium, true);
      assert.ok(!result?.offers.some((offer) => offer.country === "PS" && offer.currency === "USD"));
      assert.ok(!JSON.stringify(result).includes("Verify through independent fixture records"));
      assert.ok(!(await merchantBilling(merchant.id, paidSlug, 1))?.options.prices.some((offer) => offer.id === price.usd));
    } finally { await owner.query("update public.billing_methods set active=true where id=$1", [usdMethod]); }
  });

  await t.test("verified trials are single-use, private onboarding is capped, and expiry applies without the worker", async () => {
    assert.equal(await trialForStore(merchant.id, paidSlug), "ineligible");
    assert.deepEqual(await saveProduct(merchant.id, paidSlug, null, products("hidden", "published")), { error: "billingPublication" });
    assert.ok("id" in (await saveProduct(merchant.id, paidSlug, null, products("onboarding")) ?? {}));
    assert.equal(await trialForStore(trial.id, trialSlug), "ok");
    assert.equal(await trialForStore(trial.id, spareSlug), "ineligible");
    assert.equal(await trialForStore(trial.id, trialSlug), "ineligible");
    const state = (await merchantBilling(trial.id, trialSlug, 1))?.state;
    assert.equal(state?.status, "trialing");
    const trialEndMs = Date.parse(state?.trialEnd ?? "");
    assert.ok(trialEndMs > Date.now() + 2 * 86400000 && trialEndMs <= Date.now() + 3 * 86400000 + 60000);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => saveProduct(trial.id, trialSlug, null, products(`trial-${i}`))));
    assert.equal(results.filter((result) => result && "id" in result).length, 10);
    assert.equal(results.filter((result) => result && "error" in result && result.error === "limit").length, 2);
    await owner.query("update public.billing_trials set starts_at=now()-interval '8 days', ends_at=now()-interval '1 day' where store_id=$1", [trialId]);
    assert.equal((await merchantBilling(trial.id, trialSlug, 1))?.state.status, "expired");
    assert.deepEqual(await saveProduct(trial.id, trialSlug, null, products("another")), { error: "limit" });
    assert.deepEqual(await saveDesign(trial.id, trialSlug, 0, defaultDesign("luxury-boutique")), { error: "notEntitled" });
    const legacy = await merchantBilling(merchant.id, existingSlug, 1);
    assert.equal(legacy?.state.legacy, true);
    assert.equal(legacy?.state.plan, null);
    assert.equal(legacy?.rights.luxury, true);
    assert.equal(await trialForStore(merchant.id, existingSlug), "ineligible");
  });

  const makeInput = (which = price.pro, method = jodMethod, expected = 12345) => ({
    key: randomUUID(), price: which, method, expected, setup: null as string | null, notes: "",
  });
  const proofA = await sharp({ create: { width: 25, height: 25, channels: 3, background: "#F90" } }).webp().toBuffer();
  const proofB = await sharp({ create: { width: 25, height: 25, channels: 3, background: "#0A6" } }).webp().toBuffer();
  const proofC = await sharp({ create: { width: 25, height: 25, channels: 3, background: "#27B" } }).webp().toBuffer();
  const proofHash = (body: Buffer) => createHash("sha256").update(body).digest("hex");
  const check = (transfer: string, amount: number) => ({ action: "approve" as const, amount, currency: "JOD" as const, transfer,
    independent: `BANK-${transfer}` });
  const transfer = `TX-${randomUUID()}`;
  let requestId = "";
  let renewalId = "";

  await t.test("market and currency selection is explicit; snapshots cannot be repriced or forged", async () => {
    const available = (await merchantBilling(merchant.id, paidSlug, 1))?.options;
    assert.ok(available?.prices.some((offer) => offer.id === price.djf && offer.currency === "DJF" && offer.country === "DJ"));
    assert.ok(available?.prices.some((offer) => offer.id === price.usd && offer.currency === "USD" && offer.interval === "yearly"));
    assert.deepEqual(await createPaymentRequest(merchant.id, paidSlug, makeInput(price.pro, djfMethod)), { error: "price" });
    assert.deepEqual(await createPaymentRequest(merchant.id, paidSlug, makeInput(price.pro, jodMethod, 1)), { error: "price" });
    const input = { ...makeInput(price.pro, jodMethod, 17345), setup, notes: "Upload the branding kit after approval." };
    const results = await Promise.all([createPaymentRequest(merchant.id, paidSlug, input), createPaymentRequest(merchant.id, paidSlug, input)]);
    assert.deepEqual(results[0], results[1]);
    assert.ok(results[0] && "id" in results[0]);
    requestId = results[0].id;
    assert.deepEqual(await createPaymentRequest(merchant.id, paidSlug, { ...input, expected: 12345 }), { error: "duplicate" });
    await assert.rejects(runtime.query("update public.billing_prices set amount = 1 where id = $1", [price.pro]), { code: "42501" });
    await assert.rejects(owner.query("update public.billing_prices set amount = 1 where id = $1", [price.pro]));
    await owner.query("update public.billing_prices set active=false where id=$1", [price.pro]);
    const record = await merchantBilling(merchant.id, paidSlug, 1);
    assert.equal(record?.state.status, "pending_payment");
    assert.equal(record?.history[0].planMinor, 12345);
    assert.equal(record?.history[0].setupMinor, 5000);
    assert.equal(record?.history[0].currency, "JOD");
    assert.equal(record?.store.currency, "USD");
    assert.ok(!record?.options.prices.some((offer) => offer.id === price.pro));
    await owner.query("update public.billing_prices set active=true where id=$1", [price.pro]);
  });

  await t.test("private proof, tenant RLS, duplicate proof checks and explicit independent approval", async () => {
    assert.equal(await merchantBilling(trial.id, paidSlug, 1), null);
    assert.equal(await submitProof(trial.id, paidSlug, requestId, transfer, proofA, proofHash(proofA)), null);
    assert.equal(await reviewRequest(admin.token, requestId, check(transfer, 17345)), "closed");
    assert.equal(await submitProof(merchant.id, paidSlug, requestId, transfer, proofA, proofHash(proofA)), "ok");
    assert.equal(await submitProof(merchant.id, paidSlug, requestId, transfer, proofA, proofHash(proofA)), "ok");
    assert.equal((await merchantBilling(merchant.id, paidSlug, 1))?.state.status, "pending_payment");
    assert.equal((await runtime.query("select id from public.billing_requests")).rowCount, 0);
    const scoped = await withMerchantStore(trial.id, spareSlug, false, async (tx) =>
      (await tx.execute(sql`select id from public.billing_requests where id=${requestId}`)).rows);
    assert.deepEqual(scoped, []);
    await assert.rejects(runtime.query("select content from public.billing_proofs"), { code: "42501" });
    assert.equal(await downloadProof(merchant.token, requestId), null);
    assert.equal(await reviewRequest(merchant.token, requestId, check(transfer, 17345)), "denied");
    assert.equal(await mayReviewPayments(admin.token), true);
    await owner.query("insert into public.store_memberships(store_id,user_id,role) values ($1,$2,'staff')", [paidId, admin.id]);
    assert.equal(await downloadProof(admin.token, requestId), null);
    assert.equal(await reviewRequest(admin.token, requestId, check(transfer, 17345)), "denied");
    await owner.query("delete from public.store_memberships where store_id=$1 and user_id=$2", [paidId, admin.id]);
    assert.deepEqual(await downloadProof(admin.token, requestId), proofA);
    assert.equal((await listPaymentReviews(admin.token, requestId, true, 1))[0]?.hasProof, true);
    assert.equal(await reviewRequest(admin.token, requestId, { action: "review" }), "ok");
    assert.equal(await reviewRequest(admin.token, requestId, check(transfer, 1)), "invalid");
    assert.equal(await reviewRequest(admin.token, requestId, { ...check(transfer, 17345), currency: "USD" }), "invalid");
    const decisions = await Promise.all([1, 2].map(() => reviewRequest(admin.token, requestId, check(transfer, 17345))));
    assert.deepEqual(decisions.sort(), ["closed", "ok"]);
    const record = await merchantBilling(merchant.id, paidSlug, 1);
    assert.equal(record?.state.plan, "pro");
    assert.equal(record?.state.status, "active");
    assert.equal(record?.history[0].setupStatus, "paid");
    assert.equal(await reviewRequest(admin.token, requestId, { action: "complete_setup" }), "ok");
    assert.equal((await merchantBilling(merchant.id, paidSlug, 1))?.history[0].setupStatus, "completed");
    assert.equal((await owner.query("select request_id from public.billing_periods where store_id=$1", [paidId])).rowCount, 1);
    const attempt = await createPaymentRequest(trial.id, spareSlug, makeInput());
    assert.ok(attempt && "id" in attempt);
    assert.equal(await submitProof(trial.id, spareSlug, attempt.id, "OTHER-REFERENCE", proofA, proofHash(proofA)), "duplicate");
    assert.equal(await submitProof(trial.id, spareSlug, attempt.id, "OTHER-REFERENCE", proofB, proofHash(proofB)), "ok");
    assert.equal(await reviewRequest(admin.token, attempt.id, { action: "reject", reason: "No matching external deposit." }), "ok");
    assert.equal((await merchantBilling(trial.id, spareSlug, 1))?.history[0].reason, "No matching external deposit.");
    assert.equal((await merchantBilling(trial.id, spareSlug, 1))?.state.plan, null);
  });

  await t.test("calendar periods use UTC month-end and leap-day rules, and renewals are staged without overlap", async () => {
    const dates = await owner.query("select public.billing_period_end('2024-01-31T11:00Z','monthly') as leap, public.billing_period_end('2024-02-29T11:00Z','yearly') as yearly");
    assert.equal(dates.rows[0].leap.toISOString(), "2024-02-29T11:00:00.000Z");
    assert.equal(dates.rows[0].yearly.toISOString(), "2025-02-28T11:00:00.000Z");
    const design = switchTheme(defaultDesign(), "luxury-boutique");
    assert.deepEqual(await saveDesign(merchant.id, paidSlug, 0, design), { revision: 1 });
    assert.deepEqual(await publishDesign(merchant.id, paidSlug, 1), { revision: 1 });
    const rows = await Promise.all(Array.from({ length: 31 }, (_, i) => saveProduct(merchant.id, paidSlug, null, products(`paid-${i}`, "published"))));
    assert.equal(rows.filter((row) => row && "id" in row).length, 31);
    assert.ok("id" in (await setStorePublication(merchant.id, paidSlug, true) ?? {}));
    assert.equal((await getPublishedDesign(paidSlug)).theme, "luxury-boutique");
    const next = makeInput(price.starter, jodMethod, 6789);
    const renewal = await createPaymentRequest(merchant.id, paidSlug, next);
    assert.ok(renewal && "id" in renewal);
    renewalId = renewal.id;
    assert.deepEqual(await createPaymentRequest(merchant.id, paidSlug, next), renewal);
    assert.deepEqual(await createPaymentRequest(merchant.id, paidSlug, { ...next, key: randomUUID() }), { error: "pending" });
    const renewalTransfer = `TX-${randomUUID()}`;
    assert.equal(await submitProof(merchant.id, paidSlug, renewal.id, renewalTransfer, proofC, proofHash(proofC)), "ok");
    assert.equal(await reviewRequest(admin.token, renewal.id, check(renewalTransfer, 6789)), "ok");
    const state = (await merchantBilling(merchant.id, paidSlug, 1))?.state;
    assert.equal(state?.plan, "pro");
    assert.equal(state?.nextPlan, "starter");
    assert.equal(state?.nextPeriod, state?.periodEnd);
    assert.equal(await cancelAtEnd(merchant.id, paidSlug, true), "pending");
    await assert.rejects(owner.query("update public.billing_periods set starts_at=starts_at-interval '1 second' where request_id=$1", [renewal.id]),
      { code: "23P01", constraint: "billing_periods_no_overlap" });
  });

  await t.test("downgrade preserves products and design; grace, scheduled cancellation and suspension are server-authoritative", async () => {
    await owner.query("update public.billing_periods set starts_at=now()-interval '40 days', ends_at=now()-interval '10 days', grace_until=now()-interval '3 days' where request_id=$1", [requestId]);
    await owner.query("update public.billing_periods set starts_at=now()-interval '9 days', ends_at=now()+interval '5 days', grace_until=now()+interval '12 days' where request_id=$1", [renewalId]);
    const next = await merchantBilling(merchant.id, paidSlug, 1);
    assert.equal(next?.state.plan, "starter");
    assert.equal(next?.rights.maxProducts, 30);
    assert.equal(next?.usage.products, 32);
    assert.equal(next?.usage.byChannel, null);
    assert.equal((await getPublishedDesign(paidSlug)).theme, "minimal-commerce");
    assert.equal((await owner.query("select published->>'theme' as theme from public.store_designs where store_id=$1", [paidId])).rows[0].theme, "luxury-boutique");
    assert.deepEqual(await saveProduct(merchant.id, paidSlug, null, products("above-limit")), { error: "limit" });
    assert.equal(await cancelAtEnd(merchant.id, paidSlug, true), "ok");
    assert.ok((await merchantBilling(merchant.id, paidSlug, 1))?.state.cancelAt);
    assert.equal(await cancelAtEnd(merchant.id, paidSlug, false), "ok");
    await owner.query("update public.billing_periods set ends_at=now()-interval '1 day' where request_id=$1", [renewalId]);
    assert.equal((await merchantBilling(merchant.id, paidSlug, 1))?.state.status, "grace_period");
    // The renewal grace period keeps the public storefront online.
    assert.ok(await getPublicStore(paidSlug));
    await owner.query("update public.billing_subscriptions set cancel_at=(select ends_at from public.billing_periods where request_id=$2) where store_id=$1", [paidId, renewalId]);
    assert.equal((await merchantBilling(merchant.id, paidSlug, 1))?.state.status, "canceled");
    assert.equal(await getPublicStore(paidSlug), null, "a canceled store whose period ended is not public");
    await owner.query("update public.billing_subscriptions set cancel_at=null where store_id=$1", [paidId]);
    await owner.query("update public.billing_periods set grace_until=now()-interval '1 second' where request_id=$1", [renewalId]);
    assert.equal((await merchantBilling(merchant.id, paidSlug, 1))?.state.status, "suspended");
    // Once the paid period and the grace period have ended the storefront disappears everywhere it is read, and its data stays.
    assert.equal(await getPublicStore(paidSlug), null, "an expired store is not public");
    assert.equal((await runtime.query("select count(*)::int n from public.catalog_public_products($1,null,null,'newest',false,0,25)", [paidSlug])).rows[0].n, 0);
    const { rows: [kept] } = await owner.query<{ n: number; slug: string | null }>(
      "select count(*)::int n, (array_agg(slug) filter (where state='published'))[1] as slug from public.catalog_products where store_id=$1 and state<>'archived'", [paidId]);
    assert.ok(kept.n > 0, "the merchant's products are kept");
    if (kept.slug) assert.equal((await runtime.query("select count(*)::int n from public.catalog_public_product($1,$2)", [paidSlug, kept.slug])).rows[0].n, 0);
    await owner.query("update public.billing_periods set grace_until=now()+interval '12 days' where request_id=$1", [renewalId]);
    assert.ok(await getPublicStore(paidSlug), "the storefront returns when the subscription is renewed");
    await owner.query("update public.billing_periods set grace_until=now()-interval '1 second' where request_id=$1", [renewalId]);
    assert.deepEqual(await saveProduct(merchant.id, paidSlug, null, products("cannot-publish", "published")), { error: "billingPublication" });
  });

  await t.test("scheduled jobs can roll back and retry; an expired review session cannot read or approve proofs", async () => {
    const pending = await createPaymentRequest(trial.id, spareSlug, makeInput(price.djf, djfMethod, 4500));
    assert.ok(pending && "id" in pending);
    await owner.query("update public.billing_requests set created_at=now()-interval '80 hours', expires_at=now()-interval '1 hour' where id=$1", [pending.id]);
    await assert.rejects(runtime.query("select public.billing_expire(10)"), { code: "42501" });
    const job = await worker.connect();
    try {
      await job.query("begin");
      assert.ok((await job.query("select public.billing_expire(1000) as counts")).rows[0].counts.requests >= 1);
      await job.query("rollback");
    } finally { job.release(); }
    assert.equal((await owner.query("select status from public.billing_requests where id=$1", [pending.id])).rows[0].status, "awaiting_payment");
    await worker.query("select public.billing_expire(1000)");
    await worker.query("select public.billing_expire(1000)");
    assert.equal((await owner.query("select count(*)::int n from public.billing_audit where request_id=$1 and event='request_expired'", [pending.id])).rows[0].n, 1);
    await owner.query("update public.billing_requests set reviewed_at=now()-interval '181 days' where id=$1", [renewalId]);
    await worker.query("select public.billing_expire(1000)");
    assert.equal(await downloadProof(admin.token, renewalId), null);
    assert.equal((await owner.query("select count(*)::int n from public.billing_audit where request_id=$1 and event='proof_purged'", [renewalId])).rows[0].n, 1);
    await revokeSession(admin.token);
    assert.equal(await mayReviewPayments(admin.token), false);
    assert.equal(await downloadProof(admin.token, requestId), null);
    assert.equal(await reviewRequest(admin.token, requestId, check(transfer, 17345)), "denied");
  });

  await t.test("3-day account trial does not reset on second store and manual subscriptions activate per-store for 1, 3, 6 and 12 months", async () => {
    const multiEmail = `${name}-multi@example.test`;
    const superEmail = `${name}-super@example.test`;
    emails.push(multiEmail, superEmail);
    const multiSession = await register("Multi-store merchant", multiEmail, "long local billing password");
    const superSession = await register("Super admin", superEmail, "long local billing password");
    assert.ok(multiSession && superSession);
    const multiUser = await getSessionUser(multiSession.token);
    const superUser = await getSessionUser(superSession.token);
    assert.ok(multiUser && superUser);

    const superEnroll = makeEnrollment();
    await markPlatform(owner, superUser.id, "administrator", superEnroll);
    const superSeed = await mfaSeed(superSession.token, superEnroll, false);
    assert.ok(superSeed);
    const superStepped = await mfaVerify(superSession.token, otp(Buffer.from(superSeed, "hex")));
    assert.ok(superStepped);

    const { rows: [accountTrialBefore] } = await owner.query<{ starts_at: Date; ends_at: Date }>(
      "select starts_at, ends_at from public.platform_account_trials where user_id = $1",
      [multiUser.id],
    );
    assert.ok(accountTrialBefore);
    assert.equal(accountTrialBefore.ends_at.getTime() - accountTrialBefore.starts_at.getTime(), 72 * 3600 * 1000);

    const slugOne = `${name}-s1`;
    const slugTwo = `${name}-s2`;
    assert.ok(await createStore(multiUser.id, { slug: slugOne, name: "Store One", country: "PS", currency: "ILS" }));
    assert.ok(await createStore(multiUser.id, { slug: slugTwo, name: "Store Two", country: "PS", currency: "ILS" }));
    const storeOne = await getMemberStore(multiUser.id, slugOne);
    const storeTwo = await getMemberStore(multiUser.id, slugTwo);
    assert.ok(storeOne && storeTwo);
    tenantIds.push(storeOne.id, storeTwo.id);

    const { rows: [accountTrialAfter] } = await owner.query<{ starts_at: Date; ends_at: Date }>(
      "select starts_at, ends_at from public.platform_account_trials where user_id = $1",
      [multiUser.id],
    );
    assert.equal(accountTrialAfter.ends_at.getTime(), accountTrialBefore.ends_at.getTime());

    const billingOneInitial = await merchantBilling(multiUser.id, slugOne, 1);
    const billingTwoInitial = await merchantBilling(multiUser.id, slugTwo, 1);
    assert.equal(billingOneInitial?.state.status, "trialing");
    assert.equal(billingTwoInitial?.state.status, "expired");
    assert.equal(billingTwoInitial?.state.trialEnd, null);

    // Verify trial_started notification was enqueued only for the first store
    const { rows: trialNotifications } = await owner.query<{ window: string }>(
      "select \"window\" from public.ops_notifications where kind = 'trial_started' and recipient = $1",
      [multiUser.id],
    );
    assert.deepEqual(trialNotifications.map((r) => r.window), [storeOne.id]);

    // Merchant token and non-MFA-elevated admin token must be denied
    assert.equal(await grantManualSubscription(multiSession.token, {
      id: randomUUID(),
      user: multiUser.id,
      store: storeOne.id,
      plan: "starter",
      months: 1,
      amountMinor: 5900,
      currency: "ILS",
      reference: `WA-DENY-${name}`,
    }), "denied");

    // Activate 1-month Starter on Store One during its active trial -> starts immediately, Store Two stays untouched
    const grant1Id = randomUUID();
    const ref1 = `WA-STARTER-1M-${name}`;
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: grant1Id,
      user: multiUser.id,
      store: storeOne.id,
      plan: "starter",
      months: 1,
      amountMinor: 5900,
      currency: "ILS",
      reference: ref1,
      note: "First paid activation during trial",
    }), "ok");

    // Idempotent retry with identical payload succeeds; altered payload or duplicate reference with new ID fails
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: grant1Id,
      user: multiUser.id,
      store: storeOne.id,
      plan: "starter",
      months: 1,
      amountMinor: 5900,
      currency: "ILS",
      reference: ref1,
      note: "First paid activation during trial",
    }), "ok");
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: grant1Id,
      user: multiUser.id,
      store: storeOne.id,
      plan: "starter",
      months: 3,
      amountMinor: 5900,
      currency: "ILS",
      reference: ref1,
      note: "First paid activation during trial",
    }), "invalid");
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: randomUUID(),
      user: multiUser.id,
      store: storeOne.id,
      plan: "starter",
      months: 1,
      amountMinor: 5900,
      currency: "ILS",
      reference: ref1,
      note: "Duplicate reference attempt",
    }), "invalid");

    const billingOneAfter1M = await merchantBilling(multiUser.id, slugOne, 1);
    const billingTwoAfter1M = await merchantBilling(multiUser.id, slugTwo, 1);
    assert.equal(billingOneAfter1M?.state.status, "active");
    assert.equal(billingOneAfter1M?.state.plan, "starter");
    assert.equal(billingTwoAfter1M?.state.status, "expired");
    assert.equal(billingTwoAfter1M?.state.plan, null);
    const firstPeriodStart = billingOneAfter1M?.state.periodStart;
    const firstPeriodEnd = billingOneAfter1M?.state.periodEnd;
    assert.ok(firstPeriodStart && firstPeriodEnd);
    assert.equal(new Date(firstPeriodEnd).toISOString(), addUtcCalendarMonths(new Date(firstPeriodStart), 1).toISOString());

    // Renew Store One with 3 months of Starter while active -> appends to existing paid periodEnd
    const grant3Id = randomUUID();
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: grant3Id,
      user: multiUser.id,
      store: storeOne.id,
      plan: "starter",
      months: 3,
      amountMinor: 15900,
      currency: "ILS",
      reference: `WA-STARTER-3M-${name}`,
      note: "3-month renewal appended",
    }), "ok");

    const billingOneAfter3M = await merchantBilling(multiUser.id, slugOne, 1);
    assert.ok(billingOneAfter3M?.state.periodEnd);
    assert.equal(
      new Date(billingOneAfter3M.state.periodEnd).toISOString(),
      addUtcCalendarMonths(new Date(firstPeriodEnd), 3).toISOString(),
    );
    assert.equal(billingOneAfter3M.manualHistory.length, 2);

    // Activate Store Two (expired/unpaid) with 6 months Pro, then append 12 months Pro
    const grant6Id = randomUUID();
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: grant6Id,
      user: multiUser.id,
      store: storeTwo.id,
      plan: "pro",
      months: 6,
      amountMinor: 49900,
      currency: "USD",
      reference: `WA-PRO-6M-${name}`,
      note: "6-month Pro activation",
    }), "ok");
    const billingTwoAfter6M = await merchantBilling(multiUser.id, slugTwo, 1);
    assert.ok(billingTwoAfter6M?.state.periodStart && billingTwoAfter6M?.state.periodEnd);
    assert.equal(
      new Date(billingTwoAfter6M.state.periodEnd).toISOString(),
      addUtcCalendarMonths(new Date(billingTwoAfter6M.state.periodStart), 6).toISOString(),
    );

    const grant12Id = randomUUID();
    assert.equal(await grantManualSubscription(superStepped.token, {
      id: grant12Id,
      user: multiUser.id,
      store: storeTwo.id,
      plan: "pro",
      months: 12,
      amountMinor: 89900,
      currency: "USD",
      reference: `WA-PRO-12M-${name}`,
      note: "12-month Pro renewal",
    }), "ok");

    const billingTwoAfter18M = await merchantBilling(multiUser.id, slugTwo, 1);
    assert.equal(billingTwoAfter18M?.state.status, "active");
    assert.equal(billingTwoAfter18M?.state.plan, "pro");
    assert.equal(billingTwoAfter18M?.manualHistory.length, 2);
    assert.ok(billingTwoAfter18M?.state.periodEnd);
    assert.equal(
      new Date(billingTwoAfter18M.state.periodEnd).toISOString(),
      addUtcCalendarMonths(new Date(billingTwoAfter6M.state.periodEnd), 12).toISOString(),
    );

    // Verify subscription_active notifications were enqueued for all 4 manual activations
    const { rows: activeNotifications } = await owner.query<{ window: string }>(
      "select \"window\" from public.ops_notifications where kind = 'subscription_active' and recipient = $1",
      [multiUser.id],
    );
    assert.equal(activeNotifications.length, 4);
  });
});
