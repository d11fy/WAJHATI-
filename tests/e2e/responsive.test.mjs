import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

// Responsive + accessibility sweep over the public marketing pages and the six family-theme demos in both
// locales. It collects every defect first and asserts once, so a single run lists everything that is wrong.
const marketing = ["", "/features", "/pricing", "/faq", "/sign-in"];
const themes = ["electro-x", "maison-wear", "aura-beauty", "luma-gifts", "digital-hub", "learnpro"];
const marketingWidths = [320, 360, 375, 390, 430, 768, 1024, 1440, 1920];
const themeWidths = [320, 390, 768, 1440];
const locales = [["ar", "rtl"], ["en", "ltr"]];

function audit() {
  const visible = (element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const name = (element) => (element.getAttribute("aria-label") || "").trim()
    || (element.getAttribute("aria-labelledby") ? element.getAttribute("aria-labelledby").split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim() : "")
    || (element.textContent || "").trim()
    || element.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt")
    || (element.getAttribute("title") || "").trim();
  const issues = [];
  const describe = (element) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? "." + element.className.trim().split(/\s+/)[0] : ""}`;
  if (document.documentElement.scrollWidth > innerWidth) {
    const wide = [...document.querySelectorAll("body *")].filter((element) => {
      const box = element.getBoundingClientRect();
      return visible(element) && box.right > innerWidth + 1 && !element.closest("[aria-hidden='true']") && !/^(hidden|clip)$/.test(getComputedStyle(element.parentElement).overflowX);
    }).slice(0, 3).map(describe);
    issues.push(`horizontal overflow (${document.documentElement.scrollWidth} > ${innerWidth}) ${wide.join(", ")}`);
  }
  const h1 = [...document.querySelectorAll("h1")].filter(visible).length;
  if (h1 !== 1) issues.push(`${h1} visible h1 elements`);
  for (const image of document.querySelectorAll("img:not([alt])")) issues.push(`image without alt attribute ${image.getAttribute("src")?.slice(0, 40)}`);
  for (const element of document.querySelectorAll("a[href], button, [role='button']")) {
    if (visible(element) && !name(element)) issues.push(`unnamed ${describe(element)}`);
  }
  for (const control of document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']), select, textarea")) {
    if (visible(control) && !control.labels?.length && !name(control)) issues.push(`unlabelled ${describe(control)}[name=${control.getAttribute("name")}]`);
  }
  if (innerWidth <= 430) {
    for (const element of document.querySelectorAll("button, [role='button'], input[type='checkbox'], input[type='radio']")) {
      const box = element.getBoundingClientRect();
      if (visible(element) && (box.width < 24 || box.height < 24)) issues.push(`touch target ${Math.round(box.width)}x${Math.round(box.height)} ${describe(element)}`);
    }
  }
  return issues;
}

test("marketing pages and all six theme demos stay responsive and accessible in Arabic and English", { timeout: 900_000 }, async (t) => {
  const base = process.env.TEST_BASE_URL;
  assert.ok(base);
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" });
  t.after(() => browser.close());
  const directory = process.env.DAR_SCREENSHOTS_DIR ? join(process.env.DAR_SCREENSHOTS_DIR, "responsive-sweep") : null;
  if (directory) await mkdir(directory, { recursive: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const found = new Map();
  let checked = 0;

  async function sweep(path, widths, locale, direction, shots) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      const response = await page.goto(`${base}/${locale}${path}`, { waitUntil: "load" });
      assert.equal(response?.status(), 200, `${locale}${path} status`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(async (image) => { image.loading = "eager"; await image.decode().catch(() => {}); }));
      });
      const attributes = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
      const problems = await page.evaluate(audit);
      if (attributes.lang !== locale) problems.push(`html lang ${attributes.lang}`);
      if (attributes.dir !== direction) problems.push(`html dir ${attributes.dir}`);
      checked++;
      for (const problem of problems) {
        const key = `${locale}${path || "/"} :: ${problem}`;
        found.set(key, [...(found.get(key) ?? []), width]);
      }
      if (directory && shots.includes(width)) {
        await page.screenshot({ path: join(directory, `${locale}${path.replace(/\//g, "-") || "-home"}-${width}.png`), fullPage: true, animations: "disabled" });
      }
    }
  }

  for (const [locale, direction] of locales) {
    for (const path of marketing) await sweep(path, marketingWidths, locale, direction, [390, 1440]);
    for (const theme of themes) {
      for (const path of [`/demo/${theme}`, `/demo/${theme}/p/item-1`, `/demo/${theme}/cart`]) await sweep(path, themeWidths, locale, direction, [390, 1440]);
    }
  }

  const report = [...found].map(([key, widths]) => `${key} @ ${widths.join(",")}`);
  if (directory) await writeFile(join(directory, "report.json"), JSON.stringify({ pagesChecked: checked, issues: report }, null, 2));
  console.log(JSON.stringify({ event: "responsive_sweep", pagesChecked: checked, issues: report.length }));
  assert.deepEqual(report, [], `Responsive/accessibility issues:\n${report.join("\n")}`);
});
