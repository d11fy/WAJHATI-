import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";

const themes = ["maison-wear", "aura-beauty", "electro-x", "luma-gifts", "digital-hub", "learnpro"];
async function mediaReady(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(async (image) => { image.loading = "eager"; await image.decode(); }));
  });
}
test("public theme demos support browsing, filters and isolated simulated carts on mobile", { timeout: 240_000 }, async (t) => {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const base = process.env.TEST_BASE_URL;
  assert.ok(base);
  let writes = 0;
  page.on("request", (request) => { if (request.method() === "POST") writes++; });
  for (const theme of themes) {
    await page.goto(`${base}/ar/demo/${theme}`);
    await mediaReady(page);
    assert.equal(await page.locator("#theme-products .store-tile").count(), 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok((await page.locator('meta[name="robots"]').getAttribute("content")).includes("noindex"));
    await page.locator('select[name="category"]').selectOption("collection-2");
    await page.locator('form button').click();
    await page.waitForURL(/category=collection-2/);
    assert.ok(await page.locator("#theme-products .store-tile").count() > 0);
    await page.goto(`${base}/ar/demo/${theme}/p/item-1`);
    await page.getByRole("button", { name: "أضف إلى السلة", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "أُضيف" }).waitFor();
    await page.locator(".store-cart-link").click();
    await page.waitForURL(`${base}/ar/demo/${theme}/cart`);
    await page.locator(".demo-cart-items li").first().waitFor();
    assert.equal(await page.locator(".demo-cart-items li").count(), 1);
    await page.getByRole("button", { name: "جرّب تجهيز الطلب", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "لم يُرسل" }).waitFor();
    await page.goto(`${base}/ar/demo/${theme}/p/item-4`);
    assert.equal(await page.getByRole("button", { name: "أضف إلى السلة", exact: true }).count(), 0);
  }
  assert.equal(writes, 0, "Demos must never submit merchant orders or payments");
  await page.goto(`${base}/en/demo/maison-wear/cart`);
  await page.locator(".demo-cart-items li").first().waitFor();
  assert.equal(await page.locator(".demo-cart-items li").count(), 1);
  const otherCart = await page.evaluate(() => localStorage.getItem("wajhati-demo-v1:aura-beauty"));
  assert.equal(JSON.parse(otherCart).length, 1);
  await page.getByRole("button", { name: /Remove/ }).click();
  await page.locator(".demo-cart-items li").waitFor({ state: "detached" });
  assert.equal(await page.locator(".demo-cart-items li").count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("wajhati-demo-v1:aura-beauty")), otherCart, "Removing a Maison item must not modify the Aura cart");
  await page.goto(`${base}/en/demo/aura-beauty/cart`);
  // Full navigation initially renders the server loading state; await local cart hydration.
  await page.locator(".demo-cart-items li").first().waitFor();
  assert.equal(await page.locator(".demo-cart-items li").count(), 1, "Each theme cart is isolated");
  assert.equal((await page.goto(`${base}/ar/demo/not-a-theme`)).status(), 404);
  assert.equal((await page.goto(`${base}/ar/demo/maison-wear/p/missing`)).status(), 404);
});

test("marketing and demo surfaces fit all required widths in Arabic and English", { timeout: 240_000 }, async (t) => {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const base = process.env.TEST_BASE_URL;
  assert.ok(base);
  const directory = process.env.DAR_SCREENSHOTS_DIR && join(process.env.DAR_SCREENSHOTS_DIR, "premium-after");
  if (directory) await mkdir(directory, { recursive: true });
  for (const locale of ["ar", "en"]) for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["", "/sign-in", "/pricing"]) {
      await page.goto(`${base}/${locale}${route}`);
      await mediaReady(page);
      assert.equal(await page.locator("html").getAttribute("dir"), locale === "ar" ? "rtl" : "ltr");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${locale}${route} at ${width}`);
      if (directory) await page.screenshot({ path: join(directory, `${route.replaceAll("/", "") || "home"}-${locale}-${width}.png`), fullPage: true, animations: "disabled" });
    }
    for (const theme of themes) {
      await page.goto(`${base}/${locale}/demo/${theme}`);
      await mediaReady(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${locale} at ${width}`);
      if (directory && [390, 1440].includes(width)) await page.screenshot({ path: join(directory, `demo-${theme}-${locale}-${width}.png`), fullPage: true, animations: "disabled" });
    }
  }
  await page.goto(`${base}/ar`);
  const trigger = page.getByRole("button", { name: "لقطة سريعة للتصميم" }).first();
  await trigger.click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.equal(await trigger.evaluate((el) => document.activeElement === el), true);
});
