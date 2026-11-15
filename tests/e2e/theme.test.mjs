import assert from "node:assert/strict";
import { grantLegacyForBrowser } from "../fixtures/legacy.mjs";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import sharp from "sharp";

const password = "theme visual test password";
const titles = {
  minimal: { ar: "قهوة يومية، من رواق البن", en: "Coffee for the everyday" },
  luxury: { ar: "رواق البن، على مهل", en: "A slower cup of coffee" },
};

function artwork(kind, tint = "#B96942") {
  const pouch = `<ellipse cx="400" cy="516" rx="195" ry="28" fill="#60422F" opacity=".2"/>
    <path d="M297 113h206l38 57 18 332H241l18-332Z" fill="${tint}"/>
    <path d="M281 135h238l14 30H267Z" fill="#493126"/>
    <rect x="284" y="224" width="232" height="170" rx="3" fill="#F7E5C8"/>
    <path d="M344 357v-44a56 56 0 1 1 112 0v44M365 357v-44a35 35 0 1 1 70 0v44" fill="none" stroke="#643B30" stroke-width="6"/>
    <path d="M276 469h248" stroke="#F7E5C8" stroke-width="3" opacity=".65"/>`;
  const mug = `<ellipse cx="405" cy="462" rx="242" ry="35" fill="#60422F" opacity=".2"/>
    <path d="M540 227c137-41 126 162 11 155" fill="none" stroke="${tint}" stroke-width="38"/>
    <path d="M231 198h318v183c0 55-51 84-159 84s-159-29-159-84Z" fill="${tint}"/>
    <ellipse cx="390" cy="198" rx="159" ry="48" fill="#F6DBB4"/>
    <ellipse cx="390" cy="202" rx="139" ry="33" fill="#5B3828"/>
    <path d="M276 342h228M276 368h228" stroke="#F7E5C8" stroke-width="5" opacity=".75"/>`;
  const banner = `<rect width="800" height="600" fill="#B9916D"/><rect x="42" y="42" width="716" height="516" fill="#D8B893"/>
    <path d="M42 430L758 171v387H42Z" fill="#C5A27E"/><g transform="translate(-96 80) scale(.8)">${pouch}</g>
    <g transform="translate(362 137) scale(.52)">${mug}</g>`;
  const logo = `<rect width="800" height="600" fill="#F7E5C8"/><path d="M300 420V280a100 100 0 0 1 200 0v140M335 420V280a65 65 0 0 1 130 0v140" stroke="#643B30" stroke-width="14" fill="none"/>`;
  const content = kind === "banner" ? banner : kind === "logo" ? logo : kind === "mug" ? mug : pouch;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#E3C6A5"/><path d="M0 455L800 195v405H0Z" fill="#D4B18E"/>${content}</svg>`)).png().toBuffer();
}

async function signup(page, base, email) {
  await page.goto(`${base}/ar/sign-up`);
  await page.locator('[name="name"]').fill("تاجر رواق البن");
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole("button", { name: "إنشاء حساب", exact: true }).click();
  await page.waitForURL(`${base}/ar/dashboard`);
}

async function upload(page, selector, body) {
  const response = page.waitForResponse((result) => result.request().method() === "POST" && result.url().includes("/api/"));
  await page.locator(selector).setInputFiles({ name: "riwaq.png", mimeType: "image/png", buffer: body });
  const result = await response;
  if (result.status() !== 201) assert.fail(`Image upload returned ${result.status()}: ${await result.text()}`);
  return result;
}

async function submitAndWait(page, button, status) {
  await page.getByRole("button", { name: button, exact: true }).first().click();
  await page.waitForURL((url) => url.searchParams.get("status") === status);
}

async function confirm(page, label, status) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "تأكيد", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("status") === status);
}

async function inspect(page, url, id, title, direction, screenshot) {
  assert.equal((await page.goto(url))?.status(), 200);
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
  assert.equal(await page.locator(".store-theme").getAttribute("data-theme"), id);
  assert.equal(await page.locator("html").getAttribute("dir"), direction);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.locator(".store-banner img").evaluate((image) => image.decode());
  if (screenshot) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.allSettled(Array.from(document.images, (image) => { image.loading = "eager"; return image.decode(); }));
    });
    await page.screenshot({ path: screenshot, fullPage: true, animations: "disabled" });
  }
}

test("merchant customizes two layouts, previews privately and publishes with desktop and phone screenshots", { timeout: 180_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL, "Set TEST_BASE_URL to the local production build.");
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const directory = process.env.DAR_SCREENSHOTS_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const shot = (name) => directory ? join(directory, `${name}.png`) : undefined;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  t.after(() => browser.close());
  const owner = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const visitor = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const outsider = await browser.newPage();
  for (const page of [owner, visitor, phone, outsider]) {
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(25_000);
  }
  const slug = `riwaq-${randomUUID()}`;
  const dashboard = `${base}/ar/dashboard/stores/${slug}`;
  const preview = `${dashboard}/design/preview`;
  const ar = `${base}/ar/s/${slug}`;
  const en = `${base}/en/s/${slug}`;
  const store = "رواق البن · Riwaq";
  const banner = await artwork("banner");
  const logo = await artwork("logo");

  await signup(owner, base, `${slug}@example.test`);
  await owner.getByRole("link", { name: "إنشاء متجر" }).click();
  await owner.locator('[name="name"]').fill(store);
  await owner.locator('[name="slug"]').fill(slug);
  await owner.getByRole("button", { name: "متابعة" }).click();
  await owner.locator('[name="country"]').selectOption("JO");
  await owner.locator('[name="currency"]').selectOption("JOD");
  await owner.getByRole("button", { name: "إنشاء متجر" }).click();
  await owner.waitForURL(dashboard);
  await grantLegacyForBrowser(slug);
  await owner.goto(`${dashboard}/categories`);
  await owner.locator('[name="nameAr"]').fill("البن والقهوة");
  await owner.locator('[name="nameEn"]').fill("Coffee and beans");
  await owner.locator('[name="slug"]').fill("coffee");
  await owner.getByRole("button", { name: "حفظ", exact: true }).click();
  await owner.getByRole("heading", { name: "تعديل التصنيف" }).waitFor();
  await upload(owner, 'input[type="file"]', await artwork("pouch"));
  await owner.getByRole("img", { name: "صورة 1" }).waitFor();

  for (const [nameAr, nameEn, productSlug, color, kind] of [
    ["قهوة الهيل · 250 غ", "Cardamom Coffee · 250 g", "cardamom", "#A95636", "pouch"],
    ["كوب رواق الخزفي", "Riwaq Ceramic Cup", "ceramic-cup", "#5D7359", "mug"],
    ["خلطة الصباح", "Morning Blend", "morning-blend", "#626A43", "pouch"],
  ]) {
    await owner.goto(`${dashboard}/products/new`);
    await owner.locator('[name="nameAr"]').fill(nameAr);
    await owner.locator('[name="nameEn"]').fill(nameEn);
    await owner.locator('[name="slug"]').fill(productSlug);
    await owner.locator('[name="descriptionEn"]').fill("A selection from the Riwaq catalog, with notes on the product and its available options.");
    await owner.locator('[name="price"]').fill("12.345");
    await owner.locator('[name="compareAt"]').fill("15.000");
    await owner.locator('[name="state"]').selectOption("published");
    await owner.locator('[name="categoryIds"]').check();
    await owner.locator('[name="options"]').fill("الحجم: صغير، كبير");
    await owner.getByRole("button", { name: "حفظ", exact: true }).click();
    await owner.getByRole("heading", { name: "تعديل المنتج" }).waitFor();
    await upload(owner, 'input[type="file"]', await artwork(kind, color));
    await owner.getByRole("img", { name: "صورة 1" }).waitFor();
  }
  await owner.goto(dashboard);
  await owner.getByRole("button", { name: "نشر المتجر", exact: true }).click();
  await owner.getByRole("button", { name: "تأكيد", exact: true }).click();
  await owner.getByRole("link", { name: "عرض الصفحة العامة" }).waitFor();
  await owner.getByRole("link", { name: "تصميم المتجر", exact: true }).click();
  await owner.locator('[name="titleAr"]').fill(titles.minimal.ar);
  await owner.locator('[name="titleEn"]').fill(titles.minimal.en);
  await owner.locator('[name="descriptionAr"]').fill("بن محمّص وأدوات قهوة مختارة للبيت.");
  await owner.locator('[name="descriptionEn"]').fill("Roasted beans and coffee tools, selected for home brewing.");
  await owner.locator('[name="accent"]').fill("#204735");
  const { id: bannerId } = await (await upload(owner, 'input[name="banner"]', banner)).json();
  const { id: logoId } = await (await upload(owner, 'input[name="logo"]', logo)).json();
  const { id: iconId } = await (await upload(owner, 'input[name="icon"]', logo)).json();
  await owner.getByRole("button", { name: "قهوة الهيل · 250 غ", exact: true }).click();
  await owner.getByRole("button", { name: "البن والقهوة", exact: true }).click();
  await submitAndWait(owner, "حفظ المسودة", "saved");

  const iframe = owner.frameLocator("iframe");
  await iframe.getByRole("heading", { level: 1, name: titles.minimal.ar }).waitFor();
  assert.equal(await iframe.locator(".wajhati-platform").count(), 0);
  assert.equal(await iframe.locator("html").evaluate(() => window.innerWidth), 390);
  await owner.getByRole("button", { name: "كمبيوتر", exact: true }).click();
  assert.equal(await iframe.locator("html").evaluate(() => window.innerWidth), 1200);
  if (directory) await owner.screenshot({ path: shot("store-designer-desktop"), animations: "disabled" });
  assert.equal((await visitor.request.get(preview, { maxRedirects: 0 })).status(), 307);
  await signup(outsider, base, `${slug}-outsider@example.test`);
  assert.equal((await outsider.request.get(preview)).status(), 404);
  const privateBanner = `${base}/api/theme-assets/${slug}/${bannerId}`;
  const publicBanner = `${base}/api/store-design-media/${slug}/${bannerId}`;
  const uploadEndpoint = `${base}/api/theme-assets/${slug}?kind=banner`;
  assert.equal((await outsider.request.post(uploadEndpoint, { headers: { Origin: base, "Content-Type": "image/png" }, data: banner })).status(), 404);
  assert.equal((await owner.request.post(uploadEndpoint, { headers: { Origin: "https://foreign.invalid", "Content-Type": "image/png" }, data: banner })).status(), 403);
  assert.equal((await outsider.request.get(privateBanner)).status(), 404);
  assert.equal((await outsider.request.delete(privateBanner, { headers: { Origin: base } })).status(), 404);
  assert.equal((await visitor.request.get(publicBanner)).status(), 404);
  assert.equal((await owner.request.get(privateBanner)).status(), 200);
  await visitor.goto(ar);
  await visitor.getByRole("heading", { level: 1, name: store }).waitFor();
  assert.equal(await visitor.locator(".wajhati-platform").count(), 0);

  await confirm(owner, "نشر التصميم", "published");
  assert.equal((await visitor.request.get(publicBanner)).status(), 200);
  assert.equal((await visitor.request.get(`${base}/api/store-design-media/${slug}/${logoId}`)).status(), 200);
  assert.equal((await owner.request.delete(privateBanner, { headers: { Origin: base } })).status(), 409);
  await inspect(visitor, en, "minimal-commerce", titles.minimal.en, "ltr", shot("minimal-commerce-desktop"));
  assert.equal(await visitor.locator(".store-theme").evaluate((surface) => surface.style.getPropertyValue("--store-accent")), "#204735");
  assert.ok((await visitor.locator('link[rel="icon"]').getAttribute("href")).endsWith(iconId));
  await inspect(phone, ar, "minimal-commerce", titles.minimal.ar, "rtl", shot("minimal-commerce-mobile"));

  await owner.locator('[name="theme"][value="luxury-boutique"]').check();
  await owner.locator('[name="titleAr"]').fill(titles.luxury.ar);
  await owner.locator('[name="titleEn"]').fill(titles.luxury.en);
  await owner.getByRole("button", { name: "تأخير · التصنيفات" }).click();
  await owner.getByRole("checkbox", { name: "إظهار · التصنيفات" }).uncheck();
  await submitAndWait(owner, "حفظ المسودة", "saved");
  await iframe.getByRole("heading", { level: 1, name: titles.luxury.ar }).waitFor();
  await inspect(visitor, en, "minimal-commerce", titles.minimal.en, "ltr");
  await confirm(owner, "نشر التصميم", "published");

  await inspect(visitor, en, "luxury-boutique", titles.luxury.en, "ltr", shot("luxury-boutique-desktop"));
  await inspect(phone, ar, "luxury-boutique", titles.luxury.ar, "rtl", shot("luxury-boutique-mobile"));
  assert.equal(await visitor.locator("#theme-categories").count(), 0);
  assert.equal(await visitor.locator("#theme-products .store-tile").count(), 3);
  await phone.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await phone.locator("#theme-products").evaluate((section) => getComputedStyle(section).animationName), "none");
  await visitor.goto(`${en}/p/cardamom`);
  await visitor.getByRole("heading", { level: 1, name: "Cardamom Coffee · 250 g" }).waitFor();
  assert.equal(await visitor.locator(".store-theme").getAttribute("data-theme"), "luxury-boutique");
  assert.match(await visitor.locator("main").innerText(), /12\.345/);
  if (directory) await visitor.screenshot({ path: shot("luxury-boutique-product-desktop"), fullPage: true, animations: "disabled" });

  const longTitle = `عنوان اختبار عربي طويل مع نص مختلط ${"Riwaq".repeat(13)}`;
  await owner.locator('[name="titleAr"]').fill(longTitle);
  await submitAndWait(owner, "حفظ المسودة", "saved");
  await iframe.getByRole("heading", { level: 1, name: longTitle }).waitFor();
  assert.ok(await iframe.locator("html").evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await confirm(owner, "استعادة التصميم المنشور", "restored");
  assert.equal(await owner.locator('[name="titleAr"]').inputValue(), titles.luxury.ar);
  await inspect(phone, ar, "luxury-boutique", titles.luxury.ar, "rtl");
});
