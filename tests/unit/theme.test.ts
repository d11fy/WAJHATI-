import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { contrast, defaultDesign, emptyFamilyContent, switchTheme, themeConfig, themeIds, themeRegistry } from "../../src/lib/theme-config";

test("registry defaults are valid and a theme switch retains merchant content", () => {
  for (const theme of themeIds) assert.deepEqual(themeConfig.parse(defaultDesign(theme)), defaultDesign(theme));
  const draft = defaultDesign();
  draft.hero.titleAr = "متجر رواق 2026";
  draft.products = [randomUUID()];
  const next = switchTheme(draft, "luxury-boutique");
  assert.equal(next.version, themeRegistry[next.theme].version);
  assert.equal(next.font, "editorial");
  assert.deepEqual(next.hero, draft.hero);
  assert.deepEqual(next.products, draft.products);
  assert.deepEqual(next.sections, draft.sections);
  assert.notDeepEqual(next.colors, draft.colors);
});

test("Zod rejects markup, arbitrary colors and fonts, and insufficient contrast", () => {
  const design = defaultDesign();
  assert.equal(contrast("#000000", "#FFFFFF"), 21);
  assert.equal(themeConfig.safeParse({ ...design, hero: { ...design.hero, titleAr: "<script>alert(1)</script>" } }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, colors: { ...design.colors, background: "url(https://invalid.test)" } }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, colors: { ...design.colors, text: design.colors.background } }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, font: "custom-font", styles: "body {}" }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, hero: { ...design.hero, titleAr: "ق".repeat(121) } }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, version: 2 }).success, false);
});

test("section controls preserve a visible catalog and accept only bounded unique selections", () => {
  const design = defaultDesign();
  const hidden = design.sections.map((section) => ({ ...section, visible: section.id !== "products" }));
  assert.equal(themeConfig.safeParse({ ...design, sections: hidden }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, sections: Array(4).fill({ id: "products", visible: true }) }).success, false);
  const id = randomUUID();
  assert.equal(themeConfig.safeParse({ ...design, products: [id, id] }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, categories: Array.from({ length: 9 }, () => randomUUID()) }).success, false);
  assert.equal(themeConfig.safeParse({ ...design, sections: [...design.sections].reverse(), products: [id] }).success, true);
});

test("changing storefront families preserves each family's section layout and localized content", () => {
  const digital = defaultDesign("digital-hub");
  digital.sections = digital.sections.reverse().map((section) => ({ ...section, visible: section.id !== "comparison" }));
  digital.familyContent = { "digital-hub": { ...emptyFamilyContent, headingAr: "مقارنة", headingEn: "Comparison" } };
  const beauty = switchTheme(digital, "aura-beauty");
  assert.ok(!beauty.sections.some(({ id }) => id === "comparison"));
  assert.deepEqual(switchTheme(beauty, "digital-hub").sections, digital.sections);
  assert.deepEqual(switchTheme(beauty, "digital-hub").familyContent, digital.familyContent);
  assert.ok(themeConfig.safeParse(beauty).success);
  assert.equal(themeConfig.safeParse({ ...beauty, sections: digital.sections }).success, false);
});
