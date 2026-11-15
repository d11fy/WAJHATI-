import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { catalogFilters, categoryInput, productInput } from "../../src/lib/catalog";
import { getSessionUser, register } from "../../src/server/auth/repository";
import { checkImageTarget, finalizeImage, readMerchantImage, removeImage, reserveImage, updateImage } from "../../src/server/catalog/media";
import { archiveProduct, deleteCategory, getProductForEdit, listCategories, listProducts, saveCategory, saveProduct, setStorePublication } from "../../src/server/catalog/merchant";
import { getPublicCatalog, getPublicImage, getPublicProduct } from "../../src/server/catalog/public";
import { closeDatabase, hasDatabaseConstraint } from "../../src/server/db/client";
import { createStore, getMemberStore, getPublicStore, withMerchantStore } from "../../src/server/stores/repository";
import { markLegacy } from "../fixtures/legacy.mjs";

test("catalog against PostgreSQL using tenant-scoped runtime credentials", async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL;
  const workerUrl = process.env.TEST_MEDIA_DATABASE_URL;
  assert.ok(url && ownerUrl && workerUrl, "Set the three TEST PostgreSQL URLs for a disposable migrated database.");
  assert.equal(new URL(url).pathname, new URL(ownerUrl).pathname);
  assert.equal(new URL(url).pathname, new URL(workerUrl).pathname);
  process.env.DATABASE_URL = url;
  const raw = new Pool({ connectionString: url });
  const owner = new Pool({ connectionString: ownerUrl });
  const worker = new Pool({ connectionString: workerUrl });
  const prefix = `cat-${randomUUID()}`;
  const emails = [`${prefix}-a@example.test`, `${prefix}-b@example.test`];
  const stores = [`${prefix}-a`, `${prefix}-b`];

  t.after(async () => {
    try {
      const { rows } = await owner.query<{ id: string }>("select id from public.stores where slug = any($1)", [stores]);
      const ids = rows.map((row) => row.id);
      await owner.query("delete from public.catalog_product_categories where store_id = any($1)", [ids]);
      await owner.query("delete from public.billing_subscriptions where store_id = any($1)", [ids]);
      await owner.query("delete from public.stores where id = any($1)", [ids]);
      await owner.query("delete from public.catalog_media_gc where store_id = any($1)", [ids]);
      await owner.query("delete from public.users where email = any($1)", [emails]);
    } finally {
      await Promise.all([raw.end(), owner.end(), worker.end(), closeDatabase()]);
    }
  });

  const userIds = await Promise.all(emails.map(async (email) => {
    const session = await register("Catalog tester", email, "catalog test password");
    assert.ok(session);
    const user = await getSessionUser(session.token);
    assert.ok(user);
    return user.id;
  }));
  const [alice, bob] = userIds;
  const [storeA, storeB] = stores;
  const defaults = { name: "دار الكتالوج", country: "PS", currency: "JOD" } as const;
  assert.ok(await createStore(alice, { ...defaults, slug: storeA }));
  assert.ok(await createStore(bob, { ...defaults, slug: storeB }));
  await markLegacy(owner, storeA, storeB);
  const a = await getMemberStore(alice, storeA);
  const b = await getMemberStore(bob, storeB);
  assert.ok(a && b);

  const baseCategory = categoryInput.parse({ nameAr: "زيوت", nameEn: "Oils", slug: "oils", position: "0", visible: true });
  const baseProduct = productInput.parse({ nameAr: "زيت الزيتون", nameEn: "Olive Oil", slug: "olive-oil", position: "0",
    descriptionAr: "زيت بلدي", descriptionEn: "Local oil", price: "١٢٫٣٤٥", compareAt: "14", sku: "TEST-OLIVE",
    state: "draft", featured: true, available: true, categoryIds: [], options: "Size: Small, Large" });
  let categoryA = "";
  let categoryB = "";
  let productA = "";
  let productB = "";

  await t.test("category CRUD and uniqueness are scoped per store", async () => {
    const first = await saveCategory(alice, storeA, null, baseCategory);
    const second = await saveCategory(bob, storeB, null, baseCategory);
    assert.ok(first && "id" in first && second && "id" in second);
    categoryA = first.id;
    categoryB = second.id;
    assert.deepEqual(await saveCategory(alice, storeA, null, baseCategory), { error: "slugTaken" });
    assert.equal(await listCategories(alice, storeB), null);
    assert.equal(await saveCategory(alice, storeA, categoryB, baseCategory), null);
    assert.equal(await deleteCategory(alice, storeB, categoryB), null);
    assert.deepEqual(await saveCategory(alice, storeA, categoryA, { ...baseCategory, position: 2 }), { id: categoryA });
    const disposable = await saveCategory(alice, storeA, null, { ...baseCategory, slug: "disposable" });
    assert.ok(disposable && "id" in disposable);
    assert.deepEqual(await deleteCategory(alice, storeA, disposable.id), { id: disposable.id });
    assert.equal((await listCategories(alice, storeA))?.categories.length, 1);
  });

  await t.test("products enforce valid prices, duplicate slugs, links and scoped mutations", async () => {
    assert.deepEqual(await saveProduct(alice, storeA, null, { ...baseProduct, compareAt: "12.345" }), { error: "invalidPrices" });
    assert.deepEqual(await saveProduct(alice, storeA, null, { ...baseProduct, categoryIds: [categoryB] }), { error: "categoryInvalid" });
    const first = await saveProduct(alice, storeA, null, { ...baseProduct, categoryIds: [categoryA] });
    const second = await saveProduct(bob, storeB, null, baseProduct);
    assert.ok(first && "id" in first && second && "id" in second);
    productA = first.id;
    productB = second.id;
    assert.deepEqual(await saveProduct(alice, storeA, null, baseProduct), { error: "slugTaken" });
    assert.deepEqual(await deleteCategory(alice, storeA, categoryA), { error: "categoryLinked" });
    assert.equal(await archiveProduct(alice, storeA, productB), null);
    assert.equal(await saveProduct(alice, storeB, productB, baseProduct), null);
    assert.equal(await getProductForEdit(bob, storeA, productA), null);
    assert.equal((await getProductForEdit(alice, storeA, productA))?.product.priceMinor, 12345);
    assert.equal((await getProductForEdit(alice, storeA, productA))?.product.compareAtMinor, 14000);
  });

  await t.test("RLS needs both membership and selected store, and composite FKs reject foreign links", async () => {
    assert.equal((await raw.query("select id from public.catalog_products")).rowCount, 0);
    await assert.rejects(raw.query("insert into public.catalog_categories (store_id, slug, name_ar) values ($1, 'bad', 'bad')", [a.id]), { code: "42501" });
    await owner.query("insert into public.store_memberships (store_id, user_id, role) values ($1, $2, 'staff')", [b.id, alice]);
    const visible = await withMerchantStore(alice, storeA, false, async (tx) => (await tx.execute(sql`select id from public.catalog_products`)).rows);
    assert.deepEqual(visible, [{ id: productA }]);
    assert.equal(await setStorePublication(alice, storeB, true), null);
    await assert.rejects(withMerchantStore(alice, storeA, true, (tx) => tx.execute(sql`
      insert into public.catalog_product_categories values (${a.id}, ${productA}, ${categoryB})
    `)), (error) => hasDatabaseConstraint(error, "23503", "catalog_links_category"));
    await assert.rejects(raw.query("select * from public.catalog_claim_image_cleanup(10)"), { code: "42501" });
    await assert.rejects(worker.query("select * from public.catalog_images"), { code: "42501" });
  });

  await t.test("catalog filters and pagination preserve deterministic ordering", async () => {
    for (let index = 0; index < 13; index++) {
      const result = await saveProduct(alice, storeA, null, { ...baseProduct, slug: `page-${index}`, nameEn: `Example ${index}`, position: index });
      assert.ok(result && "id" in result);
    }
    const first = await listProducts(alice, storeA, catalogFilters({ q: "Example", state: "draft" }, true));
    const second = await listProducts(alice, storeA, catalogFilters({ q: "Example", state: "draft", page: "2" }, true));
    assert.equal(first?.products.length, 12);
    assert.equal(first?.hasNext, true);
    assert.deepEqual(second?.products.map((item) => item.slug), ["page-12"]);
    assert.equal(second?.hasNext, false);
    assert.deepEqual((await listProducts(alice, storeA, catalogFilters({ q: "%" }, true)))?.products, []);
  });

  await t.test("explicit store publication and product state gate public queries", async () => {
    assert.equal(await getPublicStore(storeA), null);
    assert.deepEqual(await setStorePublication(alice, storeA, true), { error: "emptyStore" });
    assert.equal(await getPublicProduct(storeA, "olive-oil"), null);
    const publish = await saveProduct(alice, storeA, productA, { ...baseProduct, state: "published", available: false, categoryIds: [categoryA] });
    assert.deepEqual(publish, { id: productA });
    assert.equal(await getPublicProduct(storeA, "olive-oil"), null);
    assert.ok(await setStorePublication(alice, storeA, true));
    assert.equal((await getPublicStore(storeA))?.name, defaults.name);
    assert.equal((await getPublicProduct(storeA, "olive-oil"))?.available, false);
    assert.equal(await getPublicProduct(storeA, "page-0"), null);
    assert.equal(await getPublicProduct(storeB, "olive-oil"), null);
    assert.deepEqual((await getPublicCatalog(storeA, catalogFilters({ category: "oils" })))?.products.map((item) => item.slug), ["olive-oil"]);
    assert.deepEqual((await getPublicCatalog(storeA, catalogFilters({ available: "1" })))?.products, []);
    await saveCategory(alice, storeA, categoryA, { ...baseCategory, visible: false });
    assert.deepEqual((await getPublicCatalog(storeA, catalogFilters({ category: "oils" })))?.products, []);
  });

  await t.test("media permissions, states, primary image, limit and cleanup stay scoped", async () => {
    const target = { userId: alice, store: storeA, kind: "product", target: productA } as const;
    const foreign = { ...target, userId: bob };
    const foreignProduct = { ...target, target: productB };
    assert.equal(await checkImageTarget(foreign), null);
    assert.equal(await reserveImage(foreignProduct), null);
    const reservations = await Promise.all(Array.from({ length: 9 }, () => reserveImage(target)));
    const accepted = reservations.flatMap((item) => item && "id" in item ? [item] : []);
    assert.equal(accepted.length, 8);
    assert.equal(reservations.filter((item) => item && "error" in item).length, 1);
    const [first, second, expired] = accepted;
    assert.match(first.objectKey, new RegExp(`^${a.id}/catalog/[a-f0-9-]+\\.webp$`));
    assert.equal(await getPublicImage(storeA, first.id), null);
    assert.equal(await finalizeImage(foreign, first.id), null);
    assert.ok(await finalizeImage(target, first.id));
    assert.ok(await finalizeImage(target, second.id));
    assert.equal(await readMerchantImage(foreign, first.id), null);
    assert.equal(await removeImage(foreign, first.id), null);
    assert.equal(await getPublicImage(storeB, first.id), null);
    assert.equal(await getPublicImage(storeA, first.id), first.objectKey);
    assert.ok(await updateImage(target, second.id, "primary"));
    assert.equal((await getPublicProduct(storeA, "olive-oil"))?.images[0], second.id);
    assert.ok(await removeImage(target, second.id));
    assert.equal(await getPublicImage(storeA, second.id), null);
    assert.equal((await getPublicProduct(storeA, "olive-oil"))?.images[0], first.id);
    await owner.query("update public.catalog_images set created_at = now() - interval '2 hours' where store_id = $1 and id = $2", [a.id, expired.id]);
    const claimed = await worker.query<{ object_key: string }>("select * from public.catalog_claim_image_cleanup(20)");
    assert.ok(claimed.rows.some((item) => item.object_key === second.objectKey));
    assert.ok(claimed.rows.some((item) => item.object_key === expired.objectKey));
    await worker.query("select public.catalog_ack_image_cleanup($1)", [second.objectKey]);
    assert.equal((await owner.query("select 1 from public.catalog_media_gc where object_key = $1", [second.objectKey])).rowCount, 0);
    assert.ok(await archiveProduct(alice, storeA, productA));
    assert.equal(await getPublicStore(storeA), null);
    assert.equal(await getPublicCatalog(storeA, catalogFilters({})), null);
    assert.equal(await getPublicProduct(storeA, "olive-oil"), null);
    assert.equal(await getPublicImage(storeA, first.id), null);
    assert.equal(await readMerchantImage(target, first.id), first.objectKey);
  });
});
