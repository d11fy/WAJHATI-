import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { productInput } from "../../src/lib/catalog";
import { defaultDesign, emptyFamilyContent, familyThemeIds, switchTheme } from "../../src/lib/theme-config";
import { getSessionUser, register } from "../../src/server/auth/repository";
import { trialForStore } from "../../src/server/billing/repository";
import { saveProduct, setStorePublication } from "../../src/server/catalog/merchant";
import { getPublicProduct } from "../../src/server/catalog/public";
import { closeDatabase } from "../../src/server/db/client";
import { createStore, getMemberStore } from "../../src/server/stores/repository";
import { getDesigner, publishDesign, restorePublishedDesign, saveDesign } from "../../src/server/themes/design";
import { finalizeDesignAsset, readDesignAsset, removeDesignAsset, reserveDesignAsset } from "../../src/server/themes/media";
import { getDesignPreview, getPublishedDesign, getPublishedDesignAsset, getThemeHighlights } from "../../src/server/themes/public";
import { markLegacy } from "../fixtures/legacy.mjs";

test("theme engine on migrated PostgreSQL with restricted runtime and worker roles", async (t) => {
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
  const prefix = `theme-${randomUUID()}`;
  const slugs = [`${prefix}-a`, `${prefix}-b`];
  const basicSlug = `${prefix}-basic`;
  const emails = slugs.map((slug) => `${slug}@example.test`);
  t.after(async () => {
    try {
      const fixtures = [...slugs, basicSlug];
      await owner.query("delete from public.billing_audit where store_id in (select id from public.stores where slug = any($1))", [fixtures]);
      await owner.query("delete from public.billing_trials where store_id in (select id from public.stores where slug = any($1))", [fixtures]);
      await owner.query("delete from public.billing_subscriptions where store_id in (select id from public.stores where slug = any($1))", [fixtures]);
      const { rows } = await owner.query<{ id: string }>("delete from public.stores where slug = any($1) returning id", [fixtures]);
      await owner.query("delete from public.catalog_media_gc where store_id = any($1)", [rows.map((row) => row.id)]);
      await owner.query("delete from public.billing_verified_accounts where email = any($1)", [emails]);
      await owner.query("delete from public.users where email = any($1)", [emails]);
    } finally { await Promise.all([owner.end(), runtime.end(), worker.end(), closeDatabase()]); }
  });
  const [alice, bob] = await Promise.all(emails.map(async (email, index) => {
    const session = await register("Theme test", email, "theme integration password");
    const user = await getSessionUser(session?.token);
    assert.ok(user);
    assert.ok(await createStore(user.id, { slug: slugs[index], name: "متجر الثيم", country: "JO", currency: "JOD" }));
    return user.id;
  }));
  const [slug, foreignSlug] = slugs;
  await markLegacy(owner, slug, foreignSlug);
  const store = await getMemberStore(alice, slug);
  assert.ok(store);
  const product = productInput.parse({ nameAr: "قهوة عربية", nameEn: "Coffee", slug: "coffee", position: "0", descriptionAr: "", descriptionEn: "", price: "12.345", compareAt: "", sku: "", state: "published", featured: false, available: true, categoryIds: [], options: "" });
  const first = await saveProduct(alice, slug, null, product);
  const foreign = await saveProduct(bob, foreignSlug, null, product);
  assert.ok(first && "id" in first && foreign && "id" in foreign);
  assert.ok(await setStorePublication(alice, slug, true));
  const minimal = defaultDesign();
  minimal.hero.titleAr = "عنوان منشور بالعربية";
  minimal.products = [first.id];
  let assetId = "";

  await t.test("all six base styles publish on a non-premium trial and expose only active published content", async () => {
    assert.ok(await createStore(alice, { slug: basicSlug, name: "Family fixture", country: "JO", currency: "JOD" }));
    const basic = await getMemberStore(alice, basicSlug);
    assert.ok(basic);
    await owner.query("insert into public.billing_verified_accounts(user_id,email) values ($1,$2)", [alice, emails[0]]);
    assert.equal(await trialForStore(alice, basicSlug), "ok");
    assert.equal((await getDesigner(alice, basicSlug))?.premium, false);
    assert.ok(await saveProduct(alice, basicSlug, null, product));
    assert.ok(await setStorePublication(alice, basicSlug, true));
    let revision = 0;
    let previous = defaultDesign();
    for (const theme of familyThemeIds) {
      const draft = switchTheme(previous, theme);
      const content = { ...emptyFamilyContent, headingEn: theme };
      draft.familyContent = { ...draft.familyContent, [theme]: content };
      assert.deepEqual(await saveDesign(alice, basicSlug, revision, { ...draft, font: "editorial" }), { error: "notEntitled" });
      assert.equal(await saveDesign(bob, basicSlug, revision, draft), null);
      assert.deepEqual(await saveDesign(alice, basicSlug, revision++, draft), { revision });
      assert.equal((await getPublishedDesign(basicSlug)).theme, previous.theme);
      assert.equal((await getDesignPreview(alice, basicSlug))?.config.theme, theme);
      assert.equal(await getDesignPreview(bob, basicSlug), null);
      assert.deepEqual(await publishDesign(alice, basicSlug, revision), { revision });
      const published = await getPublishedDesign(basicSlug);
      assert.equal(published.theme, theme);
      assert.deepEqual(published.colors, defaultDesign(theme).colors);
      assert.deepEqual(published.familyContent, { [theme]: content });
      assert.equal(published.sectionPreferences, undefined);
      previous = draft;
    }
    await owner.query("update public.billing_trials set starts_at=now()-interval '9 days', ends_at=now()-interval '1 day' where store_id=$1", [basic.id]);
    const next = switchTheme(previous, "electro-x");
    assert.deepEqual(await saveDesign(alice, basicSlug, revision++, next), { revision });
    assert.deepEqual(await publishDesign(alice, basicSlug, revision), { error: "notEntitled" });
  });

  await t.test("draft and assets stay private, including from another merchant", async () => {
    const asset = await reserveDesignAsset(alice, slug, "banner");
    assert.ok(asset && "id" in asset);
    assetId = asset.id;
    assert.equal(await readDesignAsset(alice, slug, assetId), null);
    assert.equal(await finalizeDesignAsset(bob, slug, assetId), null);
    assert.ok(await finalizeDesignAsset(alice, slug, assetId));
    minimal.assets.banner = assetId;
    assert.deepEqual(await saveDesign(alice, slug, 0, { ...minimal, products: [foreign.id] }), { error: "invalidReferences" });
    assert.deepEqual(await saveDesign(alice, slug, 0, minimal), { revision: 1 });
    assert.equal(await getDesigner(bob, slug), null);
    assert.equal(await getDesignPreview(bob, slug), null);
    assert.equal(await saveDesign(bob, slug, 1, minimal), null);
    assert.equal(await readDesignAsset(bob, slug, assetId), null);
    assert.equal(await removeDesignAsset(bob, slug, assetId), null);
    assert.equal((await runtime.query("select * from public.store_designs")).rowCount, 0);
    await assert.rejects(runtime.query("update public.store_designs set published = '{}'::jsonb"), { code: "42501" });
    assert.equal((await getDesignPreview(alice, slug))?.config.hero.titleAr, minimal.hero.titleAr);
    assert.deepEqual(await getPublishedDesign(slug), defaultDesign());
    assert.equal(await getPublishedDesignAsset(slug, assetId), null);
  });

  await t.test("owner publication is atomic and exposes only selected ready assets and catalog highlights", async () => {
    await owner.query("insert into public.store_memberships (store_id,user_id,role) values ($1,$2,'staff')", [store.id, bob]);
    assert.equal(await publishDesign(bob, slug, 1), null);
    assert.deepEqual(await publishDesign(alice, slug, 1), { revision: 1 });
    assert.deepEqual(await getPublishedDesign(slug), minimal);
    assert.match((await getPublishedDesignAsset(slug, assetId)) ?? "", new RegExp(`^${store.id}/theme/`));
    assert.equal(await getPublishedDesignAsset(foreignSlug, assetId), null);
    assert.deepEqual(await removeDesignAsset(alice, slug, assetId), { error: "assetInUse" });
    assert.equal((await getThemeHighlights(slug, minimal)).products[0]?.slug, "coffee");
    assert.deepEqual((await getThemeHighlights(slug, { ...minimal, products: [foreign.id] })).products, []);
  });

  await t.test("stale writes and failed publication preserve the previous design and catalog", async () => {
    const luxury = switchTheme(minimal, "luxury-boutique");
    luxury.assets = { ...luxury.assets, banner: null };
    assert.deepEqual(await saveDesign(alice, slug, 1, luxury), { revision: 2 });
    assert.deepEqual(await saveDesign(alice, slug, 1, minimal), { error: "conflict" });
    assert.deepEqual(await publishDesign(alice, slug, 1), { error: "conflict" });
    await owner.query("update public.store_designs set draft = jsonb_set(draft, '{assets,banner}', to_jsonb($2::text)) where store_id = $1", [store.id, randomUUID()]);
    assert.deepEqual(await publishDesign(alice, slug, 2), { error: "invalidReferences" });
    assert.deepEqual(await getPublishedDesign(slug), minimal);
    assert.deepEqual(await restorePublishedDesign(alice, slug, 2), { revision: 3 });
    assert.deepEqual((await getDesigner(alice, slug))?.draft, minimal);
    assert.deepEqual(await saveDesign(alice, slug, 3, luxury), { revision: 4 });
    assert.deepEqual(await publishDesign(alice, slug, 4), { revision: 4 });
    assert.equal((await getPublishedDesign(slug)).theme, "luxury-boutique");
    assert.equal((await getPublicProduct(slug, "coffee"))?.priceMinor, 12345);
  });

  await t.test("the previous snapshot and its assets remain private until an owner restores and publishes it", async () => {
    assert.equal(await getPublishedDesignAsset(slug, assetId), null);
    assert.deepEqual(await removeDesignAsset(alice, slug, assetId), { error: "assetInUse" });
    assert.equal((await getDesigner(alice, slug))?.hasPrevious, true);
    assert.equal(await restorePublishedDesign(bob, slug, 4, true), null);
    assert.deepEqual(await restorePublishedDesign(alice, slug, 3, true), { error: "conflict" });
    assert.deepEqual(await restorePublishedDesign(alice, slug, 4, true), { revision: 5 });
    assert.deepEqual((await getDesignPreview(alice, slug))?.config, minimal);
    assert.equal((await getPublishedDesign(slug)).theme, "luxury-boutique");
    assert.deepEqual(await publishDesign(alice, slug, 5), { revision: 5 });
    assert.deepEqual(await getPublishedDesign(slug), minimal);
    assert.ok(await getPublishedDesignAsset(slug, assetId));
  });

  await t.test("unattached and expired design objects are picked up by the limited cleanup worker", async () => {
    const asset = await reserveDesignAsset(alice, slug, "icon");
    const pending = await reserveDesignAsset(alice, slug, "logo");
    assert.ok(asset && "id" in asset && pending && "id" in pending);
    assert.ok(await finalizeDesignAsset(alice, slug, asset.id));
    assert.equal(await getPublishedDesignAsset(slug, asset.id), null);
    assert.ok(await removeDesignAsset(alice, slug, asset.id));
    await owner.query("update public.store_design_assets set created_at = now() - interval '2 hours' where store_id = $1 and id = $2", [store.id, pending.id]);
    const { rows } = await worker.query<{ object_key: string }>("select * from public.catalog_claim_image_cleanup(100)");
    assert.ok(rows.some((row) => row.object_key === asset.objectKey));
    assert.ok(rows.some((row) => row.object_key === pending.objectKey));
    assert.ok(!rows.some((row) => row.object_key.endsWith(`${assetId}.webp`)));
    await assert.rejects(worker.query("select * from public.store_design_assets"), { code: "42501" });
  });
});
