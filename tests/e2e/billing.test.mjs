import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { chromium, devices } from "playwright-core";
import { receiptPdf } from "../fixtures/receipt.mjs";
import { base32Bytes, makeEnrollment, markPlatform, otp } from "../fixtures/platform.mjs";

const password = "local billing browser test password";

async function signUp(page, base, locale, email, name) {
  await page.goto(`${base}/${locale}/sign-up`);
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="email"]').fill(email);
  await page.locator('[name="password"]').fill(password);
  await page.getByRole("button", { name: locale === "ar" ? "إنشاء حساب" : "Create account", exact: true }).click();
  await page.waitForURL(`${base}/${locale}/dashboard`);
}

test("bilingual merchant billing on mobile and independent administrative proof review on desktop", { timeout: 150_000 }, async (t) => {
  assert.ok(process.env.TEST_BASE_URL && process.env.TEST_MIGRATION_DATABASE_URL);
  const base = new URL(process.env.TEST_BASE_URL).origin;
  const owner = new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL });
  t.after(() => owner.end());
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  const browser = await chromium.launch(executablePath ? { executablePath } : { channel: "chrome" });
  t.after(() => browser.close());
  const mobile = await browser.newContext(devices["iPhone 13"]);
  const desktop = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const shopper = await mobile.newPage();
  const reviewer = await desktop.newPage();
  const slug = `e2e-bill-${randomUUID()}`;
  const merchantEmail = `${slug}-merchant@example.test`;
  const reviewerEmail = `${slug}-review@example.test`;
  const price = "f6500000-40ce-4782-8038-000000000001";
  const method = "f6500000-40ce-4782-8038-000000000011";
  await owner.query(`insert into public.billing_prices(id,plan_id,country,currency,interval,amount)
    select $1,id,'JO','JOD','monthly',12345 from public.billing_plans where code='pro' and version=1 on conflict do nothing`, [price]);
  await owner.query("insert into public.billing_methods values ($1,'JO','JOD','Test reconciliation','Verify through independent fixture records',true) on conflict do nothing", [method]);

  await signUp(shopper, base, "ar", merchantEmail, "تاجر دار البن");
  await shopper.goto(`${base}/ar/dashboard/new`);
  await shopper.locator('[name="name"]').fill("دار البن للتجربة");
  await shopper.locator('[name="slug"]').fill(slug);
  await shopper.getByRole("button", { name: "متابعة", exact: true }).click();
  await shopper.locator('[name="country"]').selectOption("JO");
  await shopper.locator('[name="currency"]').selectOption("USD");
  await shopper.getByRole("button", { name: "إنشاء متجر", exact: true }).click();
  const path = `/dashboard/stores/${slug}/billing`;
  await shopper.waitForURL(`${base}/ar/dashboard/stores/${slug}`);
  await shopper.getByRole("link", { name: "الفوترة والباقات" }).click();
  await shopper.getByRole("heading", { name: "الفوترة والباقات" }).waitFor();
  assert.equal(await shopper.locator("html").getAttribute("dir"), "rtl");
  assert.equal(await shopper.getByRole("button", { name: "ابدأ التجربة الموثّقة" }).count(), 0);
  await shopper.getByText("تجربة مجانية · 3 أيام (72 ساعة)", { exact: true }).waitFor();
  const waActivate = shopper.getByRole("link", { name: "تواصل معنا لتفعيل الاشتراك", exact: true });
  const waRenew = shopper.getByRole("link", { name: "تجديد الاشتراك عبر واتساب", exact: true });
  await waActivate.waitFor();
  await waRenew.waitFor();
  assert.match((await waActivate.getAttribute("href")) ?? "", /^https:\/\/wa\.me\/972567508786\?text=/);
  assert.equal(await shopper.locator('[name="price"]').count(), 0);
  const screenshotDirectory = process.env.DAR_SCREENSHOTS_DIR;
  if (screenshotDirectory) {
    await mkdir(screenshotDirectory, { recursive: true });
    await shopper.screenshot({ path: join(screenshotDirectory, "whatsapp-billing-merchant-ar-mobile.png"), fullPage: true, animations: "disabled" });
  }

  await owner.query("update public.platform_contact set enabled = false where id = 1");
  let ref = "";
  const transfer = `TEST-${randomUUID()}`;
  try {
    await shopper.reload();
    await shopper.locator('[name="price"]').selectOption(price);
    await shopper.getByRole("button", { name: "إنشاء طلب دفع", exact: true }).click();
    await shopper.getByRole("button", { name: "إرسال الإثبات", exact: true }).waitFor();
    ref = await shopper.locator("article h3").first().innerText();
    assert.match(ref, /^DAR-[A-F0-9]{20}$/);
    assert.ok(await shopper.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (screenshotDirectory) {
      await shopper.screenshot({ path: join(screenshotDirectory, "billing-merchant-rtl-mobile.png"), fullPage: true, animations: "disabled" });
    }
    await shopper.getByLabel("مرجع التحويل", { exact: true }).fill(transfer);
    await shopper.locator('input[type="file"]').setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: receiptPdf(transfer) });
    const uploaded = shopper.waitForResponse((response) => response.url().includes("/api/billing/") && response.request().method() === "POST");
    await shopper.getByRole("button", { name: "إرسال الإثبات", exact: true }).click();
    const result = await uploaded;
    assert.equal(result.status(), 200, await result.text());
    await shopper.getByText("بانتظار التحقق", { exact: true }).waitFor();
  } finally {
    await owner.query("update public.platform_contact set enabled = true where id = 1");
  }
  assert.equal((await shopper.goto(`${base}/en/payment-review`))?.status(), 404);

  await signUp(reviewer, base, "en", reviewerEmail, "Payment reviewer");
  const { rows: [reviewerUser] } = await owner.query("select id from public.users where email=$1", [reviewerEmail]);
  const enroll = makeEnrollment();
  await markPlatform(owner, reviewerUser.id, "reviewer", enroll);
  await reviewer.goto(`${base}/en/payment-review`);
  await reviewer.getByRole("heading", { name: "Administrator verification" }).waitFor();
  await reviewer.getByLabel("Current password").fill(password);
  await reviewer.getByLabel("One-time enrollment key").fill(enroll);
  await reviewer.getByRole("button", { name: "Enroll authenticator" }).click();
  const seed = base32Bytes(await reviewer.locator("code").innerText());
  await reviewer.getByLabel("Authenticator code").fill(otp(seed));
  await reviewer.getByRole("button", { name: "Verify code" }).click();
  await reviewer.getByRole("link", { name: "Continue to administration" }).click();
  await reviewer.getByRole("heading", { name: "Payment review" }).waitFor();
  const card = reviewer.locator("article").filter({ hasText: ref });
  await card.getByRole("link", { name: "View payment" }).click();
  await reviewer.getByRole("heading", { name: ref }).waitFor();
  const proofUrl = new URL(await reviewer.getByRole("link", { name: "Download private proof" }).getAttribute("href"), base).href;
  assert.equal((await shopper.request.get(proofUrl)).status(), 404);
  const privateProof = await reviewer.request.get(proofUrl);
  assert.equal(privateProof.status(), 200);
  assert.match(privateProof.headers()["cache-control"], /no-store/);
  assert.equal((await privateProof.body()).subarray(8, 12).toString("ascii"), "WEBP");
  const original = await reviewer.request.get(`${proofUrl}?source=original`);
  assert.equal(original.status(), 200);
  assert.deepEqual(await original.body(), receiptPdf(transfer));
  if (screenshotDirectory) await reviewer.screenshot({ path: join(screenshotDirectory, "billing-review-ltr-desktop.png"), fullPage: true, animations: "disabled" });

  await reviewer.getByRole("button", { name: "Mark under review", exact: true }).click();
  await reviewer.getByText("Under review", { exact: true }).waitFor();
  await reviewer.getByLabel("Total", { exact: true }).fill("12.345");
  await reviewer.getByLabel("Currency", { exact: true }).fill("JOD");
  await reviewer.locator('input[name="transfer"]').fill(transfer);
  await reviewer.getByLabel("Independent reconciliation reference", { exact: true }).fill(`EXTERNAL-${transfer}`);
  await reviewer.getByRole("checkbox", { name: "I confirmed receipt of the funds using an independent payment record." }).check();
  await reviewer.getByRole("button", { name: "Approve verified payment", exact: true }).click();
  await reviewer.getByText("Approved", { exact: true }).waitFor();

  await shopper.goto(`${base}/en${path}`);
  await shopper.getByRole("heading", { name: "Billing and plans", exact: true }).waitFor();
  await shopper.getByText("Active", { exact: true }).waitFor();
  assert.equal(await shopper.locator("html").getAttribute("dir"), "ltr");
  assert.ok(await shopper.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  if (screenshotDirectory) await shopper.screenshot({ path: join(screenshotDirectory, "billing-merchant-ltr-mobile.png"), fullPage: true, animations: "disabled" });

  await owner.query("insert into public.platform_roles(user_id, role) values ($1, 'owner') on conflict do nothing", [reviewerUser.id]);
  await reviewer.goto(`${base}/ar/platform/subscriptions?q=${encodeURIComponent(merchantEmail)}`);
  await reviewer.getByRole("heading", { name: "الاشتراكات والتفعيل" }).first().waitFor();
  await reviewer.getByText("مطابقة تامة للبريد الإلكتروني", { exact: true }).waitFor();
  const activationPanel = reviewer.locator("section.panel").filter({ hasText: "مطابقة تامة للبريد الإلكتروني" }).first();
  await activationPanel.locator('select[name="months"]').selectOption("3");
  await activationPanel.locator('input[name="amount"]').fill("159.00");
  await activationPanel.locator('input[name="reference"]').fill(`WA-${randomUUID().slice(0, 8)}`);
  await activationPanel.locator('input[name="note"]').fill("تفعيل وتجديد اشتراك المتجر لمدة 3 أشهر عبر واتساب");
  await activationPanel.locator('input[name="confirm"]').check();
  await activationPanel.getByRole("button", { name: "تأكيد وتفعيل اشتراك المتجر", exact: true }).click();
  await activationPanel.getByText("تم الحفظ.", { exact: true }).waitFor();
  if (screenshotDirectory) {
    await reviewer.screenshot({ path: join(screenshotDirectory, "platform-activation-ar-desktop.png"), fullPage: true, animations: "disabled" });
  }
  await reviewer.goto(`${base}/ar/platform/settings`);
  await reviewer.getByRole("heading", { name: "إعدادات البريد المركزي SMTP (للمالك فقط)" }).waitFor();
  if (screenshotDirectory) {
    await reviewer.screenshot({ path: join(screenshotDirectory, "platform-settings-smtp-ar-desktop.png"), fullPage: true, animations: "disabled" });
  }
});
