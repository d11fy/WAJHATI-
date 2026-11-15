import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { catalogFilters } from "../../src/lib/catalog";
import { demoCatalog, filterDemoProducts, isDemoTheme } from "../../src/lib/demo-catalog";
import { familyThemeIds, themeConfig } from "../../src/lib/theme-config";

test("all demo families have complete localized catalogs and local licensed assets", () => {
  for (const theme of familyThemeIds) for (const locale of ["ar", "en"] as const) {
    const catalog = demoCatalog(theme, locale);
    assert.equal(themeConfig.safeParse(catalog.design).success, true);
    assert.equal(catalog.products.length, 4);
    assert.equal(new Set(catalog.products.map((p) => p.slug)).size, 4);
    assert.equal(catalog.categories.length, 2);
    for (const product of catalog.products) {
      assert.ok(product.nameAr && product.nameEn && product.descriptionAr && product.descriptionEn);
      assert.ok(Number.isSafeInteger(product.priceMinor) && product.priceMinor > 0);
      assert.ok(product.compareAtMinor === null || product.compareAtMinor > product.priceMinor);
      assert.ok(existsSync(join(process.cwd(), "public", product.imageSrc)));
      assert.ok(catalog.categories.some((category) => category.slug === product.category));
    }
  }
});

test("demo filtering respects search, category, availability, sort and page without mutating catalog", () => {
  const { products } = demoCatalog("maison-wear", "ar");
  const snapshot = JSON.stringify(products);
  assert.equal(filterDemoProducts(products, catalogFilters({ q: "كنزة" })).products.length, 1);
  assert.equal(filterDemoProducts(products, catalogFilters({ q: "KNIT" })).products.length, 1);
  assert.ok(filterDemoProducts(products, catalogFilters({ available: "1" })).products.every((p) => p.available));
  assert.equal(filterDemoProducts(products, catalogFilters({ category: "collection-2" })).products.length, 2);
  const ascending = filterDemoProducts(products, catalogFilters({ sort: "price-asc" })).products;
  assert.ok(ascending.every((p, index) => !index || p.priceMinor >= ascending[index - 1].priceMinor));
  assert.equal(filterDemoProducts(products, catalogFilters({ page: "2" })).products.length, 0);
  assert.equal(filterDemoProducts(products, catalogFilters({ q: "no-match" })).products.length, 0);
  assert.equal(JSON.stringify(products), snapshot);
});

test("demo routing only admits known families and configs are isolated between requests", () => {
  for (const value of ["__proto__", "constructor", "../../secret", "unknown", "minimal-commerce"]) assert.equal(isDemoTheme(value), false);
  const first = demoCatalog("aura-beauty", "ar");
  first.design.hero.titleAr = "changed";
  assert.notEqual(demoCatalog("aura-beauty", "ar").design.hero.titleAr, "changed");
});
