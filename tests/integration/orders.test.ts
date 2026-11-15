import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { productInput } from "../../src/lib/catalog";
import { emptyContact, type CartLine, type Contact } from "../../src/lib/checkout";
import { digest } from "../../src/server/auth/crypto";
import { getSessionUser, register } from "../../src/server/auth/repository";
import { archiveProduct, saveProduct, setStorePublication } from "../../src/server/catalog/merchant";
import { closeDatabase } from "../../src/server/db/client";
import { changeOrder, getOrder, listOrders, saveOrderSettings } from "../../src/server/orders/merchant";
import { beginOrder, openOrderContact, reviewCart } from "../../src/server/orders/public";
import { createStore } from "../../src/server/stores/repository";
import { markLegacy } from "../fixtures/legacy.mjs";

test("order intents on real PostgreSQL under restricted roles", async (t) => {
  const { TEST_DATABASE_URL: url, TEST_MIGRATION_DATABASE_URL: ownerUrl, TEST_MEDIA_DATABASE_URL: workerUrl } = process.env;
  assert.ok(url && ownerUrl && workerUrl);
  process.env.DATABASE_URL = url;
  const owner = new Pool({ connectionString: ownerUrl });
  const raw = new Pool({ connectionString: url });
  const worker = new Pool({ connectionString: workerUrl });
  const slug = `ord-${randomUUID()}`;
  const foreign = `${slug}-b`;
  const emails = [slug, foreign].map((value) => `${value}@example.test`);
  t.after(async () => {
    try {
      await owner.query("delete from public.billing_subscriptions where store_id in (select id from public.stores where slug = any($1))", [[slug, foreign]]);
      await owner.query("delete from public.stores where slug = any($1)", [[slug, foreign]]);
      await owner.query("delete from public.users where email = any($1)", [emails]);
    } finally { await Promise.all([owner.end(), raw.end(), worker.end(), closeDatabase()]); }
  });
  const [alice, bob] = await Promise.all(emails.map(async (email) => {
    const session = await register("Order fixture", email, "integration test password");
    const user = await getSessionUser(session?.token);
    assert.ok(user);
    return user.id;
  }));
  assert.ok(await createStore(alice, { slug, name: "دار البن", country: "JO", currency: "JOD" }));
  assert.ok(await createStore(bob, { slug: foreign, name: "Other", country: "JO", currency: "USD" }));
  await markLegacy(owner, slug, foreign);
  const product = productInput.parse({ slug: "coffee", nameAr: "قهوة", nameEn: "Coffee", position: "0", descriptionAr: "", descriptionEn: "", price: "12.345", compareAt: "", sku: "", state: "published", featured: false, available: true, categoryIds: [], options: "الحجم: صغير، كبير\nColor: Red, Blue" });
  const saved = await saveProduct(alice, slug, null, product);
  assert.ok(saved && "id" in saved);
  assert.ok(await saveProduct(alice, slug, null, { ...product, slug: "other", state: "published" }));
  assert.ok(await saveProduct(bob, foreign, null, { ...product, price: "99.99" }));
  assert.ok(await setStorePublication(alice, slug, true));
  assert.ok(await setStorePublication(bob, foreign, true));
  const config: Contact = { ...emptyContact, enabled: true, whatsapp: true, instagram: true, defaultChannel: "whatsapp", phone: "+12025550123", handle: "dar.market", greetingAr: "مرحبًا" };
  assert.ok(await saveOrderSettings(alice, slug, config));
  assert.equal(await saveOrderSettings(bob, slug, config), null);
  const items: CartLine[] = [{ product: "coffee", quantity: 2, options: [{ group: "Color", value: "Blue" }, { group: "الحجم", value: "كبير" }] }];
  const key = digest(randomUUID());
  let reference = "";

  await t.test("the server reprices and rejects changed choices, stale totals and disabled channels", async () => {
    const quote = await reviewCart(slug, items, "ar");
    assert.equal(quote?.total, 24690);
    assert.equal((await reviewCart(foreign, items, "en"))?.total, 19998);
    assert.equal((await reviewCart(slug, [{ ...items[0], options: [] }], "ar"))?.rows[0].issue, "changedOptions");
    await saveProduct(alice, slug, saved.id, { ...product, price: "14.125" });
    const result = await beginOrder({ slug, key, items, locale: "ar", channel: "whatsapp", version: quote!.version });
    assert.ok("error" in result && result.error === "stale" && result.quote.total === 28250);
    assert.deepEqual(await beginOrder({ slug: foreign, key, items, locale: "en", channel: "instagram", version: quote!.version }), { error: "disabled" });
  });

  await t.test("parallel retries yield one intent and an immutable, tenant-scoped snapshot", async () => {
    const quote = await reviewCart(slug, items, "ar");
    const input = { slug, key, items, locale: "ar", channel: "whatsapp", version: quote!.version } as const;
    const results = await Promise.all([beginOrder(input), beginOrder(input)]);
    assert.ok("reference" in results[0] && "reference" in results[1]);
    reference = results[0].reference;
    assert.equal(results[1].reference, reference);
    assert.equal((await listOrders(alice, slug, "active", reference, 1))?.rows.length, 1);
    const intent = await getOrder(alice, slug, reference);
    assert.equal(intent?.status, "initiated");
    assert.equal(intent?.total, 28250);
    assert.equal(intent?.lines[0].unitMinor, 14125);
    assert.equal(await getOrder(bob, slug, reference), null);
    assert.equal(await changeOrder(bob, slug, reference, "confirm"), null);
    assert.equal((await raw.query("select * from public.order_intents")).rowCount, 0);
    await assert.rejects(raw.query("update public.order_intents set total=1"), { code: "42501" });
  });

  await t.test("a handoff creates one event and the merchant explicitly confirms the intent", async () => {
    assert.equal(await openOrderContact(slug, digest(randomUUID()), reference), null);
    assert.ok(await openOrderContact(slug, key, reference));
    assert.ok(await openOrderContact(slug, key, reference));
    assert.equal((await getOrder(alice, slug, reference))?.status, "contact_opened");
    assert.ok((await getOrder(alice, slug, reference))?.openedAt);
    assert.equal((await owner.query("select count(*)::int as n from public.order_intent_events e join public.order_intents i on i.store_id=e.store_id and i.id=e.intent_id where i.reference=$1", [reference])).rows[0].n, 1);
    await saveOrderSettings(alice, slug, { ...config, enabled: false });
    assert.equal(await openOrderContact(slug, key, reference), null);
    await saveOrderSettings(alice, slug, config);
    assert.ok(await changeOrder(alice, slug, reference, "confirm"));
    assert.equal((await getOrder(alice, slug, reference))?.status, "merchant_confirmed");
    assert.equal(await changeOrder(alice, slug, reference, "cancel"), null);
    assert.ok(await changeOrder(alice, slug, reference, "archive"));
    assert.equal((await listOrders(alice, slug, "archived", reference, 1))?.rows.length, 1);
  });

  await t.test("draft, unavailable and archived products cannot be handed off; expired intents are cleaned by the worker", async () => {
    const quote = await reviewCart(slug, items, "en");
    const secondKey = digest(randomUUID());
    const result = await beginOrder({ slug, key: secondKey, items, locale: "en", channel: "instagram", version: quote!.version });
    assert.ok("reference" in result);
    assert.deepEqual(await openOrderContact(slug, secondKey, result.reference), { url: "https://www.instagram.com/dar.market/" });
    for (const change of [{ state: "draft" as const }, { available: false }]) {
      await saveProduct(alice, slug, saved.id, { ...product, ...change });
      assert.equal((await reviewCart(slug, items, "ar"))?.rows[0].issue, "unavailableProduct");
      assert.deepEqual(await openOrderContact(slug, secondKey, result.reference), { stale: true });
    }
    await archiveProduct(alice, slug, saved.id);
    assert.equal((await reviewCart(slug, items, "ar"))?.rows[0].issue, "unavailableProduct");
    await owner.query("update public.order_intents set created_at = now() - interval '91 days' where reference = $1 or reference = $2", [reference, result.reference]);
    await assert.rejects(raw.query("select public.order_expire_intents(1000)"), { code: "42501" });
    assert.ok((await worker.query("select public.order_expire_intents(1000) as n")).rows[0].n >= 1);
    assert.equal(await getOrder(alice, slug, result.reference), null);
    assert.ok(await getOrder(alice, slug, reference));
  });
});
