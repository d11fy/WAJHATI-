import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { grantLegacyForBrowser } from "../fixtures/legacy.mjs";

const examples = [
  ["electro-x", "تقنية للاستخدام اليومي", "Everyday tech", "سماعات لاسلكية", "Wireless headphones", "#142D44", "#4BE7C5", '<path d="M235 315V240a165 165 0 0 1 330 0v75" fill="none" stroke="currentColor" stroke-width="38"/><rect x="195" y="233" width="107" height="157" rx="38"/><rect x="498" y="233" width="107" height="157" rx="38"/>'],
  ["maison-wear", "قطع مختارة للموسم", "Pieces for the season", "معطف بقصة واسعة", "Relaxed fit coat", "#DAC8B5", "#846750", '<path d="M319 105 253 147 185 344l82 31 38-111v182h190V264l38 111 82-31-68-197-66-42-81 56z"/><path d="m319 106 81 55-39 42-39-42m159-55-81 55 39 42 39-42M400 161v285" stroke="#ead9c7" stroke-width="5" fill="none"/>'],
  ["aura-beauty", "عناية يومية ببساطة", "A simple daily routine", "سيروم الترطيب", "Hydrating serum", "#F0C9C9", "#A45476", '<rect x="302" y="188" width="196" height="236" rx="32"/><rect x="343" y="143" width="114" height="62" rx="12"/><rect x="363" y="86" width="74" height="77" rx="35"/><rect x="322" y="252" width="156" height="96" rx="8" fill="#f8e9e4"/>'],
  ["luma-gifts", "هدايا للمناسبات", "Gifts for special occasions", "علبة هدايا", "Gift box", "#E5D6F8", "#7452B5", '<rect x="217" y="225" width="366" height="189" rx="12"/><rect x="195" y="188" width="410" height="65" rx="12"/><path d="M400 413V188c-140 2-132-99-67-73l67 73 67-73c65-26 73 75-67 73" fill="none" stroke="#cbb4ef" stroke-width="22"/>'],
  ["digital-hub", "أدوات رقمية للعمل", "Digital tools for work", "قوالب تنظيم العمل", "Workspace templates", "#14203D", "#5EE9D3", '<rect x="160" y="132" width="480" height="267" rx="22"/><rect x="174" y="176" width="452" height="209" rx="12" fill="#14203D"/><rect x="196" y="203" width="95" height="151" rx="8" opacity=".5"/><path d="M330 221h255m-255 61h255m-255 61h255" fill="none" stroke="currentColor" stroke-width="24"/>'],
  ["learnpro", "تعلّم مهارة جديدة", "Learn a new skill", "أساسيات تصميم الواجهات", "Interface design basics", "#CCD9FC", "#315DE7", '<path d="M190 167q110-48 210 23 100-71 210-23v208q-110-48-210 23-100-71-210-23z"/><path d="M400 190v208m-168-165q70-25 130 8m76 0q60-33 130-8m-336 70q70-25 130 8m76 0q60-33 130-8" fill="none" stroke="#dbe6ff" stroke-width="9"/>'],
];

async function artwork(background, color, shape, secondary) {
  const surface = secondary ? color : background;
  const ink = secondary ? background : color;
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="510">
    <rect width="800" height="510" fill="${surface}"/>
    <circle cx="400" cy="250" r="218" fill="#fff" opacity=".14"/>
    <ellipse cx="400" cy="447" rx="205" ry="17" fill="#0b1f33" opacity=".16"/>
    <g fill="${ink}" color="${ink}">${shape}</g></svg>`)).png().toBuffer();
}

const field = (page, name) => page.locator(`[name="${name}"]`);

async function upload(page, selector, buffer) {
  const response = page.waitForResponse((result) => result.request().method() === "POST" && result.url().includes("/api/"));
  await page.locator(selector).setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer });
  const result = await response;
  if (result.status() !== 201) assert.fail(`Image upload returned ${result.status()}: ${await result.text()}`);
}

async function save(page, label, query, value) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForURL((url) => url.searchParams.get(query) === value);
}

async function publish(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
}

async function waitForMedia(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll("main img"), (image) => {
      image.loading = "eager";
      return image.decode();
    }));
  });
}

async function capture(page, directory, name, theme, locale) {
  const surface = page.locator(".store-family");
  assert.equal(await surface.getAttribute("data-theme"), theme);
  assert.equal(await page.locator("html").getAttribute("dir"), locale === "ar" ? "rtl" : "ltr");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await waitForMedia(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Horizontal overflow: ${name}`);
  if (theme === "luma-gifts" && name.includes("-home-")) {
    const containsPhotos = await page.locator(".family-gift-mosaic").evaluate((mosaic) => {
      const boundary = mosaic.getBoundingClientRect();
      return [...mosaic.querySelectorAll(".store-picture")].every((photo) => {
        const rect = photo.getBoundingClientRect();
        return rect.left >= boundary.left - 1 && rect.right <= boundary.right + 1;
      });
    });
    assert.ok(containsPhotos, `Gift mosaic crosses its column: ${name}`);
  }
  if (directory) await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true, animations: "disabled" });
}

test("six independent storefronts publish and serve the catalog, product and contact cart on desktop and mobile", { timeout: 540_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL);
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  t.after(() => browser.close());
  const owner = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const visitor = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const page of [owner, visitor, phone]) page.setDefaultTimeout(20_000);
  const directory = process.env.DAR_SCREENSHOTS_DIR && join(process.env.DAR_SCREENSHOTS_DIR, "storefront-families-after");
  if (directory) await mkdir(directory, { recursive: true });
  const suffix = randomUUID().slice(0, 8);
  await owner.goto(`${base}/ar/sign-up`);
  await field(owner, "name").fill("تاجر اختبار الثيمات");
  await field(owner, "email").fill(`families-${suffix}@example.test`);
  await field(owner, "password").fill("local storefront family test password");
  await owner.getByRole("button", { name: "إنشاء حساب", exact: true }).click();
  await owner.waitForURL(`${base}/ar/dashboard`);

  for (const [index, [theme, titleAr, titleEn, itemAr, itemEn, background, color, shape]] of examples.entries()) {
    await t.test(theme, { timeout: 90_000 }, async () => {
      const slug = `family-${theme}-${suffix}`;
      const dashboard = `${base}/ar/dashboard/stores/${slug}`;
      const image = await artwork(background, color, shape, false);
      const detail = await artwork(background, color, shape, true);
      await owner.goto(`${base}/ar/dashboard/new`);
      await field(owner, "name").fill(titleAr);
      await field(owner, "slug").fill(slug);
      await owner.getByRole("button", { name: "متابعة" }).click();
      await field(owner, "country").selectOption("JO");
      await field(owner, "currency").selectOption("JOD");
      await owner.getByRole("button", { name: "إنشاء متجر" }).click();
      await owner.waitForURL(dashboard);
      await grantLegacyForBrowser(slug);

      await owner.goto(`${dashboard}/categories`);
      await field(owner, "nameAr").fill("المجموعة الرئيسية");
      await field(owner, "nameEn").fill("Main collection");
      await field(owner, "slug").fill("collection");
      await owner.getByRole("button", { name: "حفظ", exact: true }).click();
      await owner.getByRole("heading", { name: "تعديل التصنيف" }).waitFor();
      await upload(owner, 'input[type="file"]', image);
      await owner.getByRole("img", { name: "صورة 1" }).waitFor();

      let productEditor;
      for (const [productSlug, nameAr, nameEn, picture] of [
        ["selection", itemAr, itemEn, image],
        ["second", `${itemAr} · إصدار آخر`, `${itemEn} · Alternative edition`, detail],
      ]) {
        await owner.goto(`${dashboard}/products/new`);
        await field(owner, "nameAr").fill(nameAr);
        await field(owner, "nameEn").fill(nameEn);
        await field(owner, "slug").fill(productSlug);
        await field(owner, "descriptionAr").fill("تعرّف على تفاصيل هذا المنتج واختر الإصدار المناسب قبل تجهيز الطلب.");
        await field(owner, "descriptionEn").fill("Explore the product details and choose an edition before preparing your request.");
        await field(owner, "price").fill("12.345");
        await field(owner, "compareAt").fill("15.000");
        await field(owner, "state").selectOption("published");
        await field(owner, "featured").check();
        await field(owner, "categoryIds").check();
        await field(owner, "options").fill("Edition: Classic, Special");
        await owner.getByRole("button", { name: "حفظ", exact: true }).click();
        await owner.getByRole("heading", { name: "تعديل المنتج" }).waitFor();
        await upload(owner, 'input[type="file"]', picture);
        if (productSlug === "selection") {
          productEditor = owner.url().split("?")[0];
          await owner.getByRole("img", { name: "صورة 1" }).waitFor();
          await upload(owner, 'input[type="file"]', detail);
        }
      }

      await owner.goto(`${dashboard}/contact`);
      for (const name of ["enabled", "whatsapp", "instagram", "showContact"]) await field(owner, name).check();
      await field(owner, "phone").fill("+12025550123");
      await field(owner, "handle").fill("storefront.fixture");
      await save(owner, "حفظ الإعدادات", "saved", "1");
      await owner.goto(dashboard);
      await publish(owner, "نشر المتجر");
      await owner.getByRole("link", { name: "عرض الصفحة العامة" }).waitFor();
      await owner.goto(`${dashboard}/design`);
      await owner.locator(`[name="theme"][value="${theme}"]`).check();
      await field(owner, "titleAr").fill(titleAr);
      await field(owner, "titleEn").fill(titleEn);
      await field(owner, "descriptionAr").fill("تصفّح المجموعة واختر ما يناسبك.");
      await field(owner, "descriptionEn").fill("Browse the collection and find what suits you.");
      await owner.getByLabel("عبارة فوق العنوان · بالعربية", { exact: true }).fill("من كتالوج المتجر");
      await owner.getByLabel("عبارة فوق العنوان · بالإنجليزية", { exact: true }).fill("From the store catalog");
      await owner.getByLabel("عنوان القسم · بالعربية", { exact: true }).fill("عن المجموعة");
      await owner.getByLabel("عنوان القسم · بالإنجليزية", { exact: true }).fill("About the collection");
      await owner.getByLabel("نص القسم · بالعربية", { exact: true }).fill("اختيارات من كتالوج المتجر، بمقاسات وإصدارات موضّحة في صفحات المنتجات.");
      await owner.getByLabel("نص القسم · بالإنجليزية", { exact: true }).fill("Selections from the catalog, with available editions listed on each product page.");
      await upload(owner, '[name="banner"]', detail);
      await owner.getByRole("img", { name: "بنر الصفحة الرئيسية", exact: true }).waitFor();
      await save(owner, "حفظ المسودة", "status", "saved");
      const frame = owner.frameLocator("iframe");
      assert.equal(await frame.locator(".store-family").getAttribute("data-theme"), theme);
      assert.equal((await visitor.request.get(`${dashboard}/design/preview`, { maxRedirects: 0 })).status(), 307);
      const ar = `${base}/ar/s/${slug}`;
      await visitor.goto(ar);
      assert.equal(await visitor.locator(".store-theme").getAttribute("data-theme"), "minimal-commerce");
      if (directory && index === 0) {
        const before = join(directory, "..", "storefront-families-before");
        await mkdir(before, { recursive: true });
        await waitForMedia(visitor);
        await visitor.screenshot({ path: join(before, "same-catalog-before-publishing.png"), fullPage: true, animations: "disabled" });
      }
      await publish(owner, "نشر التصميم");
      await owner.waitForURL((url) => url.searchParams.get("status") === "published");
      await visitor.goto(`${base}/en/s/${slug}/cart`);
      await visitor.getByText("Your cart is empty.", { exact: true }).waitFor();

      for (const [page, width] of [[visitor, 1440], [phone, 390]]) {
        for (const locale of ["ar", "en"]) {
          const store = `${base}/${locale}/s/${slug}`;
          assert.equal((await page.goto(store)).status(), 200);
          await page.getByRole("heading", { level: 1, name: locale === "ar" ? titleAr : titleEn }).waitFor();
          await capture(page, directory, `${theme}-home-${locale}-${width}`, theme, locale);
          assert.equal((await page.goto(`${store}/p/selection`)).status(), 200);
          await page.getByRole("heading", { level: 1, name: locale === "ar" ? itemAr : itemEn }).waitFor();
          if (locale === "en") assert.match(await page.locator("main").innerText(), /12\.345/);
          await capture(page, directory, `${theme}-product-${locale}-${width}`, theme, locale);
          if (locale === "ar") {
            await page.getByLabel("Edition", { exact: true }).selectOption("Special");
            await field(page, "quantity").fill("2");
            await page.getByRole("button", { name: "أضف إلى السلة" }).click();
          }
          assert.equal((await page.goto(`${store}/cart`)).status(), 200);
          await page.locator(".store-cart-item").first().waitFor();
          await capture(page, directory, `${theme}-cart-${locale}-${width}`, theme, locale);
        }
      }
      await visitor.getByRole("radio", { name: index % 2 ? "Instagram" : "WhatsApp" }).check();
      await visitor.getByRole("button", { name: "Prepare order intent" }).click();
      await visitor.getByRole("button", { name: index % 2 ? "Open seller’s Instagram profile" : "Continue to WhatsApp" }).waitFor();
      const summary = await visitor.getByLabel("Order summary preview").inputValue();
      assert.match(summary, /24\.690/);
      if (index < 2) {
        const handoff = index ? "https://www.instagram.com/**" : "https://wa.me/**";
        await visitor.route(handoff, (route) => route.fulfill({ body: "Contact handoff intercepted in the local test" }));
        await visitor.getByRole("button", { name: index ? "Open seller’s Instagram profile" : "Continue to WhatsApp" }).click();
        await visitor.waitForURL(handoff);
        await visitor.unroute(handoff);
        const reference = /DM-[0-9A-F]{20}/.exec(summary)?.[0];
        assert.ok(reference);
        await owner.goto(`${dashboard}/orders/${reference}`);
        await owner.getByText("انتقال إلى قناة التواصل", { exact: true }).waitFor();
        const form = owner.locator("form").filter({ has: owner.getByRole("button", { name: "تأكيد الطلب يدويًا" }) });
        await form.getByRole("checkbox").check();
        await form.getByRole("button", { name: "تأكيد الطلب يدويًا" }).click();
        await owner.getByText("أكّده التاجر", { exact: true }).waitFor();
      }
      if (index === 0) {
        await owner.goto(`${dashboard}/design`);
        await field(owner, "titleAr").fill("عنوان الإصدار الثاني");
        await save(owner, "حفظ المسودة", "status", "saved");
        await publish(owner, "نشر التصميم");
        await owner.waitForURL((url) => url.searchParams.get("status") === "published");
        await publish(owner, "استعادة الإصدار السابق إلى المسودة");
        await owner.waitForURL((url) => url.searchParams.get("status") === "previousRestored");
        await owner.frameLocator("iframe").getByRole("heading", { level: 1, name: titleAr }).waitFor();
        await visitor.goto(ar);
        await visitor.getByRole("heading", { level: 1, name: "عنوان الإصدار الثاني" }).waitFor();
        await publish(owner, "نشر التصميم");
        await owner.waitForURL((url) => url.searchParams.get("status") === "published");
        await visitor.goto(ar);
        await visitor.getByRole("heading", { level: 1, name: titleAr }).waitFor();
      }

      await owner.goto(productEditor);
      await publish(owner, "أرشفة المنتج");
      await owner.waitForURL(`${dashboard}/products`);
      assert.equal((await visitor.goto(`${ar}/p/selection`)).status(), 404);
    });
  }
});
