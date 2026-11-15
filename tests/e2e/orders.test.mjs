import assert from "node:assert/strict";
import { grantLegacyForBrowser } from "../fixtures/legacy.mjs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium, devices } from "playwright-core";
import sharp from "sharp";

async function fixtureStore(page, base, slug, name) {
  await page.goto(`${base}/ar/dashboard/new`);
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="slug"]').fill(slug);
  await page.getByRole("button", { name: "متابعة" }).click();
  await page.locator('[name="country"]').selectOption("JO");
  await page.locator('[name="currency"]').selectOption("JOD");
  await page.getByRole("button", { name: "إنشاء متجر" }).click();
  const path = `${base}/ar/dashboard/stores/${slug}`;
  await page.waitForURL(path);
  await grantLegacyForBrowser(slug);
  return path;
}

async function settings(page, dashboard) {
  await page.goto(`${dashboard}/contact`);
  await page.locator('[name="enabled"]').check();
  await page.locator('[name="whatsapp"]').check();
  await page.locator('[name="instagram"]').check();
  await page.locator('[name="showContact"]').check();
  await page.locator('[name="phone"]').fill("+12025550123");
  await page.locator('[name="handle"]').fill("riwaq.shop");
  await page.locator('[name="greetingAr"]').fill("مرحبًا من رواق البن");
  await page.locator('[name="greetingEn"]').fill("Hello from Riwaq");
  await page.locator('[name="instructionsEn"]').fill("Ask the seller about collection and delivery.");
  await page.getByText("مرحبًا من رواق البن", { exact: false }).last().waitFor();
  await page.getByRole("button", { name: "حفظ الإعدادات", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("saved") === "1");
}

async function product(page, dashboard, picture) {
  await page.goto(`${dashboard}/products/new`);
  await page.locator('[name="nameAr"]').fill("قهوة الهيل · 250 غ");
  await page.locator('[name="nameEn"]').fill("Cardamom Coffee · 250 g");
  await page.locator('[name="slug"]').fill("coffee");
  await page.locator('[name="price"]').fill("12.345");
  await page.locator('[name="state"]').selectOption("published");
  await page.locator('[name="options"]').fill("الحجم: صغير، كبير\nColor: Red, Blue");
  await page.getByRole("button", { name: "حفظ", exact: true }).click();
  await page.getByRole("heading", { name: "تعديل المنتج" }).waitFor();
  const edit = page.url();
  if (picture) {
    await page.locator('input[type="file"]').setInputFiles({ name: "coffee.png", mimeType: "image/png", buffer: picture });
    await page.getByRole("img", { name: "صورة 1" }).waitFor();
  }
  await page.goto(dashboard);
  await page.getByRole("button", { name: "نشر المتجر", exact: true }).click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  await page.getByRole("link", { name: "عرض الصفحة العامة" }).waitFor();
  return edit;
}

async function add(page, color, quantity, locale = "en") {
  await page.getByLabel("الحجم", { exact: true }).selectOption("كبير");
  await page.getByLabel("Color", { exact: true }).selectOption(color);
  await page.locator('[name="quantity"]').fill(String(quantity));
  await page.getByRole("button", { name: locale === "ar" ? "أضف إلى السلة" : "Add to cart", exact: true }).click();
}

async function screenshot(page, name) {
  const directory = process.env.DAR_SCREENSHOTS_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(Array.from(document.images, (image) => { image.loading = "eager"; return image.decode(); }));
  });
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true, animations: "disabled" });
}

test("themed checkout on desktop, iPhone and Android with seller handoff and explicit confirmation", { timeout: 180_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL);
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chrome" });
  t.after(() => browser.close());
  const seller = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const iphone = await browser.newPage({ ...devices["iPhone 13"], defaultBrowserType: "chromium" });
  const android = await browser.newPage({ ...devices["Pixel 7"] });
  for (const page of [seller, desktop, iphone, android]) page.setDefaultTimeout(15_000);
  const slug = `basket-${randomUUID()}`;
  const second = `${slug}-b`;
  await seller.goto(`${base}/ar/sign-up`);
  await seller.locator('[name="name"]').fill("تاجر رواق البن");
  await seller.locator('[name="email"]').fill(`${slug}@example.test`);
  await seller.locator('[name="password"]').fill("test fixture order password");
  await seller.getByRole("button", { name: "إنشاء حساب", exact: true }).click();
  await seller.waitForURL(`${base}/ar/dashboard`);
  const dashboard = await fixtureStore(seller, base, slug, "رواق البن · Riwaq");
  const picture = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="360"><rect width="400" height="360" fill="#e6c5a3"/><path fill="#964f37" d="M132 58h136l22 230H110z"/><path stroke="#422a24" stroke-width="18" d="M132 65h136"/><rect x="145" y="125" width="110" height="100" fill="#f5e5cc"/><path d="M170 203v-30a30 30 0 0 1 60 0v30" fill="none" stroke="#964f37" stroke-width="5"/></svg>`)).png().toBuffer();
  const edit = await product(seller, dashboard, picture);
  await settings(seller, dashboard);
  const otherDashboard = await fixtureStore(seller, base, second, "متجر آخر");
  await product(seller, otherDashboard);
  await settings(seller, otherDashboard);

  const store = `${base}/en/s/${slug}`;
  const endpoint = `${base}/api/checkout/${slug}`;
  await desktop.goto(`${store}/p/coffee`);
  await desktop.getByRole("button", { name: "Add to cart" }).click();
  assert.equal(await desktop.getByRole("status").filter({ hasText: "Product added" }).count(), 0);
  await add(desktop, "Blue", 1);
  await add(desktop, "Blue", 1);
  await add(desktop, "Red", 1);
  await desktop.getByRole("link", { name: /^Cart/ }).click();
  await desktop.locator(".store-cart-item").first().waitFor();
  assert.equal(await desktop.locator(".store-cart-item").count(), 2);
  await desktop.locator(".store-cart-item").first().getByLabel("Quantity").selectOption("3");
  await desktop.locator(".store-cart-item").last().getByRole("button", { name: "Remove" }).click();
  await desktop.getByText("JOD 37.035", { exact: true }).first().waitFor();
  await desktop.goto(`${base}/en/s/${second}/cart`);
  await desktop.getByText("Your cart is empty.").waitFor();
  await desktop.goto(`${store}/cart`);
  await desktop.getByText("JOD 37.035", { exact: true }).first().waitFor();
  const forged = await desktop.request.post(endpoint, { headers: { Origin: base }, data: { action: "review", locale: "en", total: 1, items: [] } });
  assert.equal(forged.status(), 400);
  const foreign = await desktop.request.post(endpoint, { headers: { Origin: "https://foreign.invalid" }, data: { action: "review", locale: "en", items: [] } });
  assert.equal(foreign.status(), 403);

  await seller.goto(edit.split("?")[0]);
  await seller.locator('[name="price"]').fill("14.125");
  await seller.getByRole("button", { name: "حفظ", exact: true }).click();
  await seller.waitForURL((url) => url.searchParams.get("saved") === "1");
  await desktop.getByRole("button", { name: "Prepare order intent" }).click();
  await desktop.getByRole("alert").filter({ hasText: "prices changed" }).waitFor();
  await desktop.getByText("JOD 42.375", { exact: true }).first().waitFor();
  await desktop.getByRole("button", { name: "Prepare order intent" }).click();
  await desktop.getByRole("button", { name: "Continue to WhatsApp" }).waitFor();
  const text = await desktop.getByLabel("Order summary preview").inputValue();
  const reference = /DM-[0-9A-F]{20}/.exec(text)?.[0];
  assert.ok(reference);
  assert.match(text, /42\.375/);
  assert.equal(await desktop.locator(".store-theme").getAttribute("data-theme"), "minimal-commerce");
  await screenshot(desktop, "orders-minimal-desktop");
  await desktop.route("https://wa.me/**", (route) => route.fulfill({ body: "WhatsApp navigation intercepted" }));
  await desktop.getByRole("button", { name: "Continue to WhatsApp" }).click();
  await desktop.waitForURL("https://wa.me/**");
  const wa = new URL(desktop.url());
  assert.equal(wa.pathname, "/12025550123");
  assert.equal(wa.searchParams.get("text"), text);
  await seller.goto(`${dashboard}/orders/${reference}`);
  await seller.getByText("انتقال إلى قناة التواصل", { exact: true }).waitFor();
  const confirm = seller.locator("form").filter({ has: seller.getByRole("button", { name: "تأكيد الطلب يدويًا" }) });
  await confirm.getByRole("checkbox").check();
  await confirm.getByRole("button", { name: "تأكيد الطلب يدويًا" }).click();
  await seller.getByText("أكّده التاجر", { exact: true }).waitFor();

  await desktop.goto(`${store}/cart`);
  await desktop.getByRole("radio", { name: "Instagram" }).check();
  await desktop.getByRole("button", { name: "Prepare order intent" }).click();
  await desktop.route("https://www.instagram.com/**", (route) => route.fulfill({ body: "Instagram desktop profile intercepted" }));
  await desktop.getByRole("button", { name: "Open seller’s Instagram profile" }).click();
  await desktop.waitForURL("https://www.instagram.com/riwaq.shop/");

  await seller.goto(`${dashboard}/design`);
  await seller.locator('[name="theme"][value="luxury-boutique"]').check();
  await seller.getByRole("button", { name: "حفظ المسودة", exact: true }).first().click();
  await seller.waitForURL((url) => url.searchParams.get("status") === "saved");
  await seller.getByRole("button", { name: "نشر التصميم", exact: true }).click();
  await seller.getByRole("alertdialog").getByRole("button", { name: "تأكيد" }).click();
  await seller.waitForURL((url) => url.searchParams.get("status") === "published");

  await iphone.goto(`${base}/ar/s/${slug}/p/coffee`);
  await add(iphone, "Red", 1, "ar");
  await iphone.getByRole("link", { name: /^السلة/ }).click();
  await iphone.getByRole("button", { name: "تجهيز طلب مبدئي" }).waitFor();
  assert.equal(await iphone.locator("html").getAttribute("dir"), "rtl");
  assert.equal(await iphone.locator(".store-theme").getAttribute("data-theme"), "luxury-boutique");
  assert.ok(await iphone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await iphone.getByRole("button", { name: "تجهيز طلب مبدئي" }).click();
  await iphone.getByRole("button", { name: "انتقل إلى واتساب" }).waitFor();
  await screenshot(iphone, "orders-luxury-iphone");
  await iphone.route("https://wa.me/**", (route) => route.fulfill({ body: "WhatsApp phone navigation intercepted" }));
  await iphone.getByRole("button", { name: "انتقل إلى واتساب" }).click();
  await iphone.waitForURL("https://wa.me/**");
  assert.match(new URL(iphone.url()).searchParams.get("text"), /مرحبًا من رواق البن/);

  await android.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await android.goto(`${store}/p/coffee`);
  await add(android, "Blue", 1);
  await android.getByRole("link", { name: /^Cart/ }).click();
  await android.getByRole("radio", { name: "Instagram" }).check();
  await android.getByRole("button", { name: "Prepare order intent" }).click();
  await android.getByRole("button", { name: "Copy summary" }).click();
  await android.getByText("Summary copied.").waitFor();
  const copied = await android.evaluate(() => navigator.clipboard.readText());
  assert.equal(copied.replace(/\r\n/g, "\n"), await android.getByLabel("Order summary preview").inputValue());
  assert.match(copied, /Reference: DM-/);
  assert.ok(await android.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await screenshot(android, "orders-luxury-android");
  await android.route("https://www.instagram.com/**", (route) => route.fulfill({ body: "Instagram profile navigation intercepted" }));
  await android.getByRole("button", { name: "Open seller’s Instagram profile" }).click();
  await android.waitForURL("https://www.instagram.com/riwaq.shop/");
});
