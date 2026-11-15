import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { Pool } from "pg";

const password = "a long test-only password";

test("platform identity uses the approved fonts and direction on desktop and mobile", { timeout: 150_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL);
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  t.after(() => browser.close());
  const db = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;
  if (db) t.after(() => db.end());
  const palestinian = db ? (await db.query("select public.billing_marketing() as value")).rows[0].value.catalog
    .filter(({ country, currency }) => country === "PS" && currency === "USD") : [];
  const folder = process.env.DAR_SCREENSHOTS_DIR && join(process.env.DAR_SCREENSHOTS_DIR, "polish-after");
  if (folder) await mkdir(folder, { recursive: true });
  for (const [locale, direction, family, brand] of [["ar", "rtl", "Cairo Variable", "واجهتي"], ["en", "ltr", "Poppins", "WAJHATI"]]) {
    for (const [viewport, width, height] of [["desktop", 1440, 920], ["mobile", 390, 856]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      for (const [path, screen] of [["", "home"], ["/sign-in", "sign-in"]]) {
        assert.equal((await page.goto(`${base}/${locale}${path}`))?.status(), 200);
        assert.equal(await page.locator("html").getAttribute("dir"), direction);
        assert.equal(await page.locator("header").getByRole("link", { name: brand, exact: true }).count(), 1);
        await page.locator("header img").evaluate((image) => image.decode());
        const rendered = await page.evaluate(async ({ family, brand }) => {
          const platform = document.querySelector(".wajhati-platform");
          const faces = await document.fonts.load(`700 16px "${family}"`, brand);
          return { font: getComputedStyle(platform).fontFamily, loaded: faces.length > 0, fits: document.documentElement.scrollWidth <= window.innerWidth };
        }, { family, brand });
        assert.ok(rendered.font.replaceAll('"', "").startsWith(family) && rendered.loaded && rendered.fits);
        if (folder) await page.screenshot({ path: join(folder, `${screen}-${locale}-${viewport}.png`), fullPage: true });
        if (viewport === "desktop") {
          for (const breakpoint of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
            await page.setViewportSize({ width: breakpoint, height });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen} ${locale} at ${breakpoint}`);
            if (folder) await page.screenshot({ path: join(folder, `${screen}-${locale}-${breakpoint}.png`) });
          }
        }
      }
      for (const route of ["features", "pricing", "faq"]) {
        assert.equal((await page.goto(`${base}/${locale}/${route}`))?.status(), 200);
        assert.equal(await page.locator("main h1").count(), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (route === "pricing" && await page.locator('select[name="market"]').count()) {
          assert.ok(await page.locator(".premium-price-features li").count(), "Published plan features are visible.");
          assert.equal(await page.locator('[data-offer="unavailable"] a, [data-offer="unavailable"] button').count(), 0);
          if (palestinian.length) {
            await page.goto(`${base}/${locale}/pricing?market=PS-USD`);
            assert.equal(await page.locator('[data-offer="published"]').count(), palestinian.length);
            for (const offer of palestinian) {
              const plan = page.locator(".premium-price-layout").filter({ has: page.getByRole("heading", { name: offer.name, exact: true }) });
              const card = plan.locator(".premium-price-card").nth(offer.interval === "monthly" ? 0 : 1);
              const price = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(offer.amount / 100);
              assert.equal(await card.locator(".premium-price-amount > bdi").textContent(), price);
              if (offer.canPurchase) assert.equal(await card.getByRole("link").count(), 1);
              else { assert.equal(await card.getByRole("link").count(), 0); assert.equal(await card.getByRole("button").isDisabled(), true); }
            }
          }
        }
        if (route === "faq") {
          const item = page.locator("main details").nth(1);
          await item.locator("summary").click();
          assert.notEqual(await item.getAttribute("open"), null);
        }
        if (folder) await page.screenshot({ path: join(folder, `${route}-${locale}-${viewport}.png`), fullPage: true });
        if (route === "pricing" && viewport === "desktop") {
          for (const breakpoint of [320, 360, 375, 390, 430, 768, 1024, 1440]) {
            await page.setViewportSize({ width: breakpoint, height });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `pricing ${locale} at ${breakpoint}`);
            if (folder) await page.screenshot({ path: join(folder, `pricing-${locale}-${breakpoint}.png`) });
          }
        }
      }
      await page.close();
    }
  }
});

async function signUp(page, base, locale, email, name) {
  await page.goto(`${base}/${locale}/sign-up`);
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole("button", { name: locale === "ar" ? "إنشاء حساب" : "Create account" }).click();
  await page.waitForURL(`${base}/${locale}/dashboard`);
}

test("Foundation login, draft storefront and tenant isolation through the production UI", { timeout: 120_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL, "Set TEST_BASE_URL to the app using a disposable test database.");
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  t.after(() => browser.close());
  const first = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const second = await browser.newContext();
  const visitor = await browser.newContext();
  const owner = await first.newPage();
  const outsider = await second.newPage();
  const publicPage = await visitor.newPage();
  const slug = `e2e-${randomUUID()}`;
  const name = "دار الزيتون للاختبار";
  const email = `${slug}-one@example.test`;
  const privatePath = `/ar/dashboard/stores/${slug}`;

  await owner.goto(base);
  await owner.waitForURL(`${base}/ar`);
  assert.equal(await owner.locator("html").getAttribute("dir"), "rtl");
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await signUp(owner, base, "ar", email, "تاجر الاختبار");
  await owner.getByRole("link", { name: "إنشاء متجر" }).click();
  if (process.env.DAR_SCREENSHOTS_DIR) {
    const directory = join(process.env.DAR_SCREENSHOTS_DIR, "wajhati-current");
    await mkdir(directory, { recursive: true });
    await owner.screenshot({ path: join(directory, "onboarding-ar-mobile.png"), fullPage: true });
  }
  await owner.locator('[name="name"]').fill(name);
  await owner.locator('[name="slug"]').fill(slug.toUpperCase());
  await owner.getByRole("button", { name: "متابعة" }).click();
  await owner.locator('[name="country"]').selectOption("PS");
  await owner.locator('[name="currency"]').selectOption("JOD");
  await owner.getByRole("button", { name: "إنشاء متجر" }).click();
  await owner.waitForURL(`${base}${privatePath}`);
  await owner.getByRole("heading", { name }).waitFor();

  const cookie = (await first.cookies()).find((item) => item.name === "__Host-dar_session");
  assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === "Lax");

  const publicResponse = await publicPage.goto(`${base}/ar/s/${slug}`);
  assert.equal(publicResponse?.status(), 404);
  assert.ok(!(await publicPage.content()).includes(email));

  await publicPage.goto(`${base}${privatePath}`);
  await publicPage.waitForURL(`${base}/ar/sign-in`);
  await signUp(outsider, base, "en", `${slug}-two@example.test`, "Other merchant");
  assert.ok(!(await outsider.locator("main").innerText()).includes(name));
  assert.equal((await outsider.goto(`${base}${privatePath}`))?.status(), 404);
  assert.ok(!(await outsider.content()).includes(name));

  await owner.getByRole("button", { name: "تسجيل الخروج" }).click();
  await owner.waitForURL(`${base}/ar/sign-in`);
  await visitor.addCookies([cookie]);
  await publicPage.goto(`${base}${privatePath}`);
  await publicPage.waitForURL(`${base}/ar/sign-in`);

  await owner.locator('[name="email"]').fill(email);
  await owner.locator('[name="password"]').fill(password);
  const loginRequest = owner.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
  await owner.getByRole("button", { name: "تسجيل الدخول" }).click();
  await owner.waitForURL(`${base}/ar/dashboard`);
  await owner.getByRole("heading", { name }).waitFor();
  const original = await loginRequest;
  const originalHeaders = original.headers();
  const body = original.postDataBuffer();
  assert.ok(body && originalHeaders["next-action"] && originalHeaders["content-type"]);
  const foreignOrigin = await owner.request.post(original.url(), {
    headers: { "next-action": originalHeaders["next-action"], "content-type": originalHeaders["content-type"], Origin: "https://foreign.invalid" }, data: body,
  });
  assert.ok(foreignOrigin.status() >= 400);
});
