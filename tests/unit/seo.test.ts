import assert from "node:assert/strict";
import { test } from "node:test";
import { crawlable, marketingMetadata, robotsRules, sitemapEntries } from "../../src/lib/seo";

const production = { DAR_ENV: "production", APP_ORIGIN: "https://wajhati.example" };

test("only the production HTTPS environment is crawlable; staging and development disallow everything", () => {
  assert.equal(crawlable(production), true);
  assert.equal(crawlable({ ...production, DAR_ENV: "staging" }), false);
  assert.equal(crawlable({ ...production, DAR_ENV: "development" }), false);
  assert.equal(crawlable({ APP_ORIGIN: "https://wajhati.example" }), false);
  assert.equal(crawlable({ DAR_ENV: "production", APP_ORIGIN: "http://wajhati.example" }), false);
  assert.deepEqual(robotsRules({ ...production, DAR_ENV: "staging" }), { rules: [{ userAgent: "*", disallow: ["/"] }] });
  assert.deepEqual(sitemapEntries({ ...production, DAR_ENV: "staging" }), []);
});

test("production robots.txt blocks private areas in both locales and points at the sitemap", () => {
  const { rules, sitemap } = robotsRules(production);
  const disallow = rules[0].disallow as string[];
  for (const locale of ["ar", "en"]) {
    for (const section of ["dashboard", "platform", "account", "payment-review", "identity", "demo", "sign-in"]) assert.ok(disallow.includes(`/${locale}/${section}`), `${locale}/${section}`);
  }
  assert.ok(disallow.includes("/api/"));
  assert.equal(sitemap, "https://wajhati.example/sitemap.xml");
});

test("the sitemap lists only marketing pages with hreflang alternates and no private or storefront URLs", () => {
  const entries = sitemapEntries(production);
  assert.equal(entries.length, 8);
  for (const entry of entries) {
    assert.match(entry.url, /^https:\/\/wajhati\.example\/(ar|en)(\/(features|pricing|faq))?$/);
    assert.deepEqual(Object.keys(entry.alternates.languages).sort(), ["ar", "en"]);
  }
  assert.ok(!entries.some((entry) => /dashboard|platform|\/s\//.test(entry.url)));
});

test("marketing metadata sets a canonical URL, language alternates and matching social tags", () => {
  const meta = marketingMetadata("en", "/pricing", "Pricing", "Choose a plan");
  assert.equal(meta.alternates?.canonical, "/en/pricing");
  assert.deepEqual(meta.alternates?.languages, { ar: "/ar/pricing", en: "/en/pricing", "x-default": "/ar/pricing" });
  assert.equal(meta.description, "Choose a plan");
  assert.equal((meta.openGraph as { url: string }).url, "/en/pricing");
});
