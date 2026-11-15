import assert from "node:assert/strict";
import { grantLegacyForBrowser } from "../fixtures/legacy.mjs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import sharp from "sharp";

const password = "catalog end to end password";

async function account(page, base, email, mode) {
  await page.goto(`${base}/ar/${mode}`);
  if (mode === "sign-up") await page.locator('[name="name"]').fill("تاجر الكتالوج");
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole("button", { name: mode === "sign-up" ? "إنشاء حساب" : "تسجيل الدخول", exact: true }).click();
  await page.waitForURL(`${base}/ar/dashboard`);
}

async function image(background) {
  return sharp({ create: { width: 60, height: 50, channels: 3, background } }).png().toBuffer();
}

test("sign in, create a category and a product with images, publish and browse on mobile", { timeout: 240_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL, "Set TEST_BASE_URL to a production build using disposable PostgreSQL and S3 storage.");
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  t.after(() => browser.close());
  const merchant = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const outsider = await browser.newPage();
  const slug = `cat-e2e-${randomUUID()}`;
  const email = `${slug}@example.test`;
  const path = `/ar/dashboard/stores/${slug}`;
  const publicPath = `/ar/s/${slug}`;
  const productPath = `${publicPath}/p/olive-oil`;
  const red = await image("red");
  const blue = await image("blue");
  const folder = process.env.DAR_SCREENSHOTS_DIR && join(process.env.DAR_SCREENSHOTS_DIR, "polish-after");
  if (folder) await mkdir(folder, { recursive: true });

  await account(merchant, base, email, "sign-up");
  await merchant.getByRole("button", { name: "تسجيل الخروج" }).click();
  await merchant.waitForURL(`${base}/ar/sign-in`);
  await account(merchant, base, email, "sign-in");
  await merchant.getByRole("link", { name: "إنشاء متجر" }).click();
  await merchant.locator('[name="name"]').fill("متجر اختبار الزيتون");
  await merchant.locator('[name="slug"]').fill(slug);
  await merchant.getByRole("button", { name: "متابعة" }).click();
  await merchant.locator('[name="country"]').selectOption("PS");
  await merchant.locator('[name="currency"]').selectOption("JOD");
  await merchant.getByRole("button", { name: "إنشاء متجر" }).click();
  try {
    await merchant.waitForURL(`${base}${path}`, { waitUntil: "commit" });
  } catch (error) {
    const alert = await merchant.getByRole("alert").allTextContents();
    throw new Error(`Store creation stopped at ${new URL(merchant.url()).pathname}. Alerts: ${alert.join(" | ")}`, { cause: error });
  }
  await grantLegacyForBrowser(slug);
  assert.equal((await visitor.goto(`${base}${publicPath}`))?.status(), 404);

  await merchant.getByRole("link", { name: "التصنيفات", exact: true }).click();
  await merchant.locator('[name="nameAr"]').fill("الزيوت");
  await merchant.locator('[name="nameEn"]').fill("Oils");
  await merchant.locator('[name="slug"]').fill("oils");
  await merchant.getByRole("button", { name: "حفظ", exact: true }).click();
  await merchant.getByRole("heading", { name: "تعديل التصنيف" }).waitFor();
  await merchant.getByRole("link", { name: "المنتجات", exact: true }).click();
  await merchant.getByRole("link", { name: "إضافة منتج" }).click();
  await merchant.locator('[name="nameAr"]').fill("زيت الزيتون");
  await merchant.locator('[name="nameEn"]').fill("Olive Oil");
  await merchant.locator('[name="slug"]').fill("olive-oil");
  await merchant.locator('[name="descriptionEn"]').fill("Cold-pressed olive oil");
  await merchant.locator('[name="price"]').fill("١٢٫٣٤٥");
  await merchant.locator('[name="compareAt"]').fill("14");
  await merchant.locator('[name="categoryIds"]').check();
  await merchant.locator('[name="featured"]').check();
  await merchant.locator('[name="options"]').fill("الحجم: صغير، كبير");
  await merchant.getByRole("button", { name: "حفظ", exact: true }).click();
  await merchant.getByRole("heading", { name: "تعديل المنتج" }).waitFor();
  const productId = new URL(merchant.url()).pathname.split("/").at(-1);
  const upload = `${base}/api/catalog/${slug}/product/${productId}`;
  const headers = { Origin: base, "Content-Type": "image/png" };

  assert.equal((await visitor.request.post(upload, { headers, data: red })).status(), 404);
  assert.equal((await merchant.request.post(upload, { headers: { ...headers, Origin: "https://attacker.invalid" }, data: red })).status(), 403);
  assert.equal((await merchant.request.post(upload, { headers, data: Buffer.from("not an image") })).status(), 415);
  await account(outsider, base, `${slug}-outsider@example.test`, "sign-up");
  assert.equal((await outsider.request.post(upload, { headers, data: red })).status(), 404);
  assert.equal((await outsider.goto(merchant.url()))?.status(), 404);

  await merchant.locator('input[type="file"]').setInputFiles([
    { name: "red.png", mimeType: "image/png", buffer: red }, { name: "blue.png", mimeType: "image/png", buffer: blue },
  ]);
  const secondImage = merchant.getByRole("img", { name: "صورة 2" });
  await secondImage.waitFor();
  const secondPath = await secondImage.getAttribute("src");
  const secondId = secondPath.split("/").at(-1);
  assert.equal((await outsider.request.delete(`${upload}/${secondId}`, { headers })).status(), 404);
  assert.equal((await outsider.request.get(`${upload}/${secondId}`)).status(), 404);
  assert.equal((await visitor.request.get(`${base}/api/store-media/${slug}/${secondId}`)).status(), 404);
  await merchant.getByRole("button", { name: "جعلها رئيسية" }).click();
  await merchant.getByRole("img", { name: "صورة 2" }).locator("..").getByText("رئيسية", { exact: true }).waitFor();

  assert.equal((await visitor.goto(`${base}${productPath}`))?.status(), 404);
  await merchant.locator('[name="state"]').selectOption("published");
  await merchant.getByRole("button", { name: "حفظ", exact: true }).click();
  await merchant.locator("span.tag").filter({ hasText: /^منشور$/ }).waitFor();
  assert.equal((await visitor.goto(`${base}${productPath}`))?.status(), 404);
  await merchant.goto(`${base}${path}`);
  await merchant.getByRole("button", { name: "نشر المتجر", exact: true }).click();
  await merchant.getByRole("button", { name: "تأكيد", exact: true }).click();
  await merchant.getByRole("link", { name: "عرض الصفحة العامة" }).waitFor();
  const publishedCount = merchant.getByText("المنتجات المنشورة", { exact: true }).locator("..").locator("dd");
  assert.equal(await publishedCount.textContent(), new Intl.NumberFormat("ar").format(1));
  await merchant.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await merchant.getByRole("button", { name: "نسخ الرابط", exact: true }).click();
  await merchant.getByRole("status").getByText("تم نسخ الرابط").waitFor();
  assert.equal(await merchant.evaluate(() => navigator.clipboard.readText()), `${base}${publicPath}`);
  await merchant.goto(`${base}${path}/products`);
  const toggle = merchant.getByRole("button", { name: "الفلاتر", exact: true });
  await toggle.click();
  const drawer = merchant.getByRole("dialog");
  await drawer.getByLabel("الحالة").selectOption("archived");
  await merchant.keyboard.press("Escape");
  assert.equal(await drawer.isVisible(), false);
  assert.ok(await toggle.evaluate((node) => node === document.activeElement));
  await toggle.click();
  assert.equal(await drawer.getByLabel("الحالة").inputValue(), "");
  await drawer.getByLabel("الحالة").selectOption("archived");
  if (folder) await merchant.screenshot({ path: join(folder, "products-ar-filter-drawer.png") });
  const filteredRequest = (url) => url.pathname === `${path}/products` && url.searchParams.get("state") === "archived";
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await merchant.route(filteredRequest, async (route) => { await held; await route.continue(); });
  try {
    await drawer.getByRole("button", { name: "تطبيق", exact: true }).click();
    await merchant.locator(".wajhati-filter-loading").waitFor();
    if (folder) await merchant.screenshot({ path: join(folder, "products-ar-loading.png") });
  } finally { release(); }
  await merchant.getByRole("link", { name: "عرض كل المنتجات" }).waitFor();
  await merchant.unroute(filteredRequest);
  if (folder) await merchant.screenshot({ path: join(folder, "products-ar-empty-filter.png") });
  await merchant.getByRole("link", { name: "عرض كل المنتجات" }).click();
  await merchant.getByText("زيت الزيتون", { exact: true }).waitFor();
  if (folder) {
    const products = `${base}${path}/products`;
    await merchant.goto(`${base}${path}`);
    await merchant.screenshot({ path: join(folder, "store-overview-ar-mobile.png"), fullPage: true });
    await merchant.goto(products);
    await merchant.getByText("زيت الزيتون", { exact: true }).waitFor();
    assert.ok(await merchant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await merchant.screenshot({ path: join(folder, "products-ar-mobile.png"), fullPage: true });
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 920 }, storageState: await merchant.context().storageState() });
    await desktop.goto(`${base}${path}`);
    await desktop.screenshot({ path: join(folder, "store-overview-ar-desktop.png"), fullPage: true });
    await desktop.goto(products);
    await desktop.getByText("زيت الزيتون", { exact: true }).waitFor();
    await desktop.screenshot({ path: join(folder, "products-ar-desktop.png"), fullPage: true });
    await desktop.close();
    for (const locale of ["ar", "en"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, storageState: await merchant.context().storageState() });
      await page.goto(`${base}/${locale}/dashboard/stores/${slug}/products`);
      await page.getByText(locale === "ar" ? "زيت الزيتون" : "Olive Oil", { exact: true }).waitFor();
      for (const width of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        const geometry = await page.evaluate(() => {
          const row = document.querySelector(".wajhati-product-row").getBoundingClientRect();
          const nav = document.querySelector(".wajhati-workspace-tabs");
          const pane = document.querySelector(".wajhati-workspace-pane");
          const paneBounds = pane.getBoundingClientRect();
          const visible = getComputedStyle(nav).display !== "none";
          return {
            direction: document.documentElement.dir,
            fits: document.documentElement.scrollWidth <= innerWidth && pane.scrollWidth <= pane.clientWidth,
            clears: !visible || (paneBounds.bottom <= nav.getBoundingClientRect().top && row.bottom <= paneBounds.bottom),
          };
        });
        assert.deepEqual(geometry, { direction: locale === "ar" ? "rtl" : "ltr", fits: true, clears: true }, `Catalog ${locale} at ${width}`);
        await page.screenshot({ path: join(folder, `products-${locale}-${width}.png`) });
      }
      await page.locator(".wajhati-workspace-content").screenshot({ path: join(folder, `catalog-preview-${locale}.png`) });
      await page.setViewportSize({ width: 320, height: 360 });
      const edit = page.locator(".wajhati-product-edit");
      await edit.scrollIntoViewIfNeeded();
      assert.ok(await edit.evaluate((node) => {
        const action = node.getBoundingClientRect();
        const pane = document.querySelector(".wajhati-workspace-pane").getBoundingClientRect();
        return action.top >= pane.top && action.bottom <= pane.bottom;
      }), `The last product action remains reachable in a short ${locale} viewport`);
      await page.close();
    }
  }

  assert.equal((await visitor.goto(`${base}${publicPath}?q=Olive&category=oils`))?.status(), 200);
  await visitor.getByRole("link", { name: /زيت الزيتون/ }).click();
  await visitor.waitForURL(`${base}${productPath}`);
  await visitor.getByRole("heading", { name: "زيت الزيتون" }).waitFor();
  assert.equal(await visitor.locator("html").getAttribute("dir"), "rtl");
  assert.ok(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  assert.ok((await visitor.locator('meta[property="og:image"]').getAttribute("content")).endsWith(secondId));
  await visitor.getByLabel("الحجم").selectOption({ label: "كبير" });
  await visitor.getByRole("link", { name: "English" }).click();
  await visitor.getByRole("heading", { name: "Olive Oil" }).waitFor();
  assert.equal(await visitor.locator("html").getAttribute("dir"), "ltr");
  assert.match(await visitor.locator("main").innerText(), /12\.345/);
  const publicImage = await visitor.request.get(`${base}/api/store-media/${slug}/${secondId}`);
  assert.equal(publicImage.status(), 200);
  assert.equal(publicImage.headers()["content-type"], "image/webp");
  assert.equal((await sharp(await publicImage.body()).metadata()).format, "webp");

  assert.equal((await merchant.request.delete(`${upload}/${secondId}`, { headers })).status(), 204);
  assert.equal((await visitor.request.get(`${base}/api/store-media/${slug}/${secondId}`)).status(), 404);
});
