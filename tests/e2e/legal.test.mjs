import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

const copy = {
  ar: { dir: "rtl", privacy: "سياسة الخصوصية", terms: "شروط الخدمة", legal: "الوثائق القانونية", draft: "مسودة بانتظار اعتماد المالك والمراجعة القانونية" },
  en: { dir: "ltr", privacy: "Privacy Policy", terms: "Terms of Service", legal: "Legal documents", draft: "Draft pending owner approval and legal review" },
};

test("legal pages render in both languages as marked drafts and are reachable from every entry point", { timeout: 240_000 }, async (t) => {
  const base = process.env.TEST_BASE_URL;
  assert.ok(base);
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" });
  t.after(() => browser.close());
  const directory = process.env.DAR_SCREENSHOTS_DIR ? join(process.env.DAR_SCREENSHOTS_DIR, "legal") : null;
  if (directory) await mkdir(directory, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const [locale, text] of Object.entries(copy)) {
    for (const kind of ["privacy", "terms"]) {
      const response = await page.goto(`${base}/${locale}/${kind}`);
      assert.equal(response.status(), 200, `${locale}/${kind}`);
      assert.equal(await page.locator("html").getAttribute("dir"), text.dir);
      assert.equal(await page.locator("html").getAttribute("lang"), locale);
      await page.getByRole("heading", { level: 1, name: text[kind] }).waitFor();
      // Draft safeguards: banner, highlighted open items, noindex, no sitemap/index claim.
      await page.getByRole("note").filter({ hasText: text.draft }).waitFor();
      assert.ok(await page.locator("mark[data-owner-review]").count() > 0, "open items are highlighted");
      // Placeholders always render as readable owner-review markers, never as raw template tokens.
      assert.ok(!(await page.locator("main").innerText()).includes("{{"), "no raw placeholder token is shown");
      assert.match(await page.locator("mark[data-owner-review]").first().innerText(), /OWNER|LEGAL|المالك|القانوني/);
      assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/);
      assert.match(await page.locator('link[rel="canonical"]').getAttribute("href"), new RegExp(`/${locale}/${kind}$`));
      const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => links.map((link) => link.hreflang).sort());
      assert.deepEqual(alternates, ["ar", "en", "x-default"]);
      assert.ok(await page.locator('a[href="mailto:support@wajhati.store"]').count() > 0, "support email is a link");
      assert.ok(await page.locator('a[href^="https://wa.me/"]').count() > 0, "official WhatsApp is a link");
      // Table of contents jumps to a real section.
      const first = page.locator(".wajhati-legal-toc a").nth(2);
      const target = (await first.getAttribute("href")).slice(1);
      await first.click();
      await page.waitForFunction((id) => location.hash === `#${id}`, target);
      assert.ok(await page.locator(`section#${target} h2`).isVisible());
      if (directory) await page.screenshot({ path: join(directory, `${kind}-${locale}-desktop.png`), fullPage: true, animations: "disabled" });
    }
  }

  // The language switch keeps the same document.
  await page.goto(`${base}/ar/terms`);
  await page.locator('a[hreflang="en"]').first().click();
  await page.waitForURL(`${base}/en/terms`);

  // Entry points: marketing footer, sign-in.
  for (const [locale, text] of Object.entries(copy)) {
    await page.goto(`${base}/${locale}`);
    const footerLinks = page.locator("footer").getByRole("navigation", { name: text.legal });
    await footerLinks.getByRole("link", { name: text.privacy }).waitFor();
    await footerLinks.getByRole("link", { name: text.terms }).click();
    await page.waitForURL(`${base}/${locale}/terms`);
    await page.goto(`${base}/${locale}/sign-in`);
    await page.getByRole("navigation", { name: text.legal }).getByRole("link", { name: text.terms }).waitFor();
  }

  // Phone layout: tables stack instead of overflowing, nothing scrolls sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const kind of ["privacy", "terms"]) {
    await page.goto(`${base}/ar/${kind}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${kind} overflows at 390px`);
    if (directory) await page.screenshot({ path: join(directory, `${kind}-ar-mobile.png`), fullPage: true, animations: "disabled" });
  }
  // The verification environment is not production, so robots must disallow everything.
  const robots = await (await page.request.get(`${base}/robots.txt`)).text();
  assert.match(robots, /Disallow: \/\s*$/m);
});
