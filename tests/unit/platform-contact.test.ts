import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  addUtcCalendarMonths,
  defaultPlatformWhatsapp,
  formatWhatsappPhone,
  normalizeWhatsappPhone,
  previewSubscriptionDates,
  smtpInput,
  subscriptionContact,
  transactionalEmailCatalog,
} from "../../src/lib/platform-contact";
import { sendIdentityMail, sendOperationsMail } from "../../src/server/auth/mail";
import { openSmtpPassword, publicSmtpAddress, sealSmtpPassword } from "../../src/server/auth/smtp";

test("WhatsApp phone normalization, international formatting, and bilingual subscription links", () => {
  assert.equal(defaultPlatformWhatsapp, "972567508786");
  assert.equal(normalizeWhatsappPhone("+972 56-750-8786"), "972567508786");
  assert.equal(normalizeWhatsappPhone("00972567508786"), "972567508786");
  assert.equal(normalizeWhatsappPhone("972567508786"), "972567508786");
  assert.equal(normalizeWhatsappPhone("0567508786"), null);
  assert.equal(normalizeWhatsappPhone("abc"), null);
  assert.equal(formatWhatsappPhone("972567508786"), "+972567508786");
  assert.equal(formatWhatsappPhone("invalid"), "+972567508786");

  const arActivate = subscriptionContact("+972567508786", "ar", {
    store: "دار القهوة",
    email: "merchant@example.com",
    plan: "pro",
    interval: "yearly",
    mode: "activate",
  });
  assert.ok(arActivate?.startsWith("https://wa.me/972567508786?text="));
  const arDecoded = decodeURIComponent(arActivate!.split("?text=")[1]);
  assert.match(arDecoded, /تفعيل اشتراك متجري \(دار القهوة\)/);
  assert.match(arDecoded, /merchant@example\.com/);
  assert.match(arDecoded, /Pro \(الاحترافية\)/);
  assert.match(arDecoded, /سنوي/);

  const enRenew = subscriptionContact("972567508786", "en", {
    store: "Olive House",
    email: "olive@example.com",
    plan: "starter",
    interval: "monthly",
    mode: "renew",
  });
  assert.ok(enRenew?.startsWith("https://wa.me/972567508786?text="));
  const enDecoded = decodeURIComponent(enRenew!.split("?text=")[1]);
  assert.match(enDecoded, /renew my store subscription \(Olive House\)/);
  assert.match(enDecoded, /olive@example\.com/);
  assert.match(enDecoded, /Starter/);
  assert.match(enDecoded, /Monthly/);
});

test("UTC calendar-month arithmetic and subscription date preview for 1, 3, 6, and 12 months", () => {
  assert.equal(addUtcCalendarMonths(new Date("2024-01-31T10:30:00.000Z"), 1).toISOString(), "2024-02-29T10:30:00.000Z");
  assert.equal(addUtcCalendarMonths(new Date("2025-01-31T10:30:00.000Z"), 1).toISOString(), "2025-02-28T10:30:00.000Z");
  assert.equal(addUtcCalendarMonths(new Date("2026-05-15T08:00:00.000Z"), 3).toISOString(), "2026-08-15T08:00:00.000Z");
  assert.equal(addUtcCalendarMonths(new Date("2026-08-31T08:00:00.000Z"), 6).toISOString(), "2027-02-28T08:00:00.000Z");
  assert.equal(addUtcCalendarMonths(new Date("2024-02-29T12:00:00.000Z"), 12).toISOString(), "2025-02-28T12:00:00.000Z");

  const now = new Date("2026-06-01T12:00:00.000Z");
  const immediate = previewSubscriptionDates("2026-05-20T12:00:00.000Z", 3, now);
  assert.equal(immediate.appendsToActive, false);
  assert.equal(immediate.startsAt, "2026-06-01T12:00:00.000Z");
  assert.equal(immediate.endsAt, "2026-09-01T12:00:00.000Z");

  const appended = previewSubscriptionDates("2026-07-15T12:00:00.000Z", 6, now);
  assert.equal(appended.appendsToActive, true);
  assert.equal(appended.startsAt, "2026-07-15T12:00:00.000Z");
  assert.equal(appended.endsAt, "2027-01-15T12:00:00.000Z");
});

test("SMTP validation, AES-256-GCM encryption at rest, and SSRF private-IP protection", () => {
  const prevKey = process.env.SMTP_CONFIG_KEY;
  process.env.SMTP_CONFIG_KEY = "a".repeat(64);
  try {
    const cipher = sealSmtpPassword("my-smtp-secret-password");
    assert.ok(Buffer.isBuffer(cipher) && cipher.byteLength > 28);
    assert.ok(!cipher.toString("utf8").includes("my-smtp-secret-password"));
    assert.equal(openSmtpPassword(cipher), "my-smtp-secret-password");
  } finally {
    process.env.SMTP_CONFIG_KEY = prevKey;
  }

  assert.equal(publicSmtpAddress("127.0.0.1"), false);
  assert.equal(publicSmtpAddress("10.0.0.1"), false);
  assert.equal(publicSmtpAddress("172.16.5.4"), false);
  assert.equal(publicSmtpAddress("192.168.1.1"), false);
  assert.equal(publicSmtpAddress("169.254.169.254"), false);
  assert.equal(publicSmtpAddress("100.64.1.1"), false);
  assert.equal(publicSmtpAddress("::1"), false);
  assert.equal(publicSmtpAddress("fe80::1"), false);
  assert.equal(publicSmtpAddress("fc00::1"), false);
  assert.equal(publicSmtpAddress("8.8.8.8"), true);
  assert.equal(publicSmtpAddress("2606:4700:4700::1111"), true);

  assert.ok(smtpInput.safeParse({
    host: "smtp.wajhati.ps",
    port: "587",
    user: "mailer@wajhati.ps",
    from: "no-reply@wajhati.ps",
    name: "واجهتي | WAJHATI",
    replyTo: "support@wajhati.ps",
  }).success);
  assert.equal(smtpInput.safeParse({
    host: "localhost",
    port: "25",
    user: "root",
    from: "bad",
    name: "",
  }).success, false);
  assert.equal(transactionalEmailCatalog.length, 9);
});

test("all bilingual identity and subscription operational email templates render and deduplicate by notification ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wajhati-mail-templates-"));
  const previous = { ...process.env };
  Object.assign(process.env, {
    DAR_ENV: "staging",
    DAR_STAGING_LOCAL: "true",
    APP_ORIGIN: "https://localhost:8443",
    MAIL_PROVIDER: "local",
    DAR_MAIL_DIR: directory,
  });
  try {
    for (const locale of ["ar", "en"] as const) {
      for (const purpose of ["signup", "verify", "reset", "change_old", "change_new"] as const) {
        await sendIdentityMail(locale, `${purpose}-${locale}@example.test`, purpose, randomUUID());
      }
      for (const kind of ["trial_started", "billing_due", "subscription_active", "subscription_expired"] as const) {
        const id = randomUUID();
        assert.equal(await sendOperationsMail(locale, `merchant-${locale}@example.test`, kind, id, "olive-store"), "sent");
        // Duplicate delivery with the same notification id is idempotent
        assert.equal(await sendOperationsMail(locale, `merchant-${locale}@example.test`, kind, id, "olive-store"), "sent");
      }
      const reviewId = randomUUID();
      assert.equal(await sendOperationsMail(locale, `reviewer-${locale}@example.test`, "review_pending", reviewId, null), "sent");
    }
    const files = await readdir(directory);
    assert.equal(files.length, 20);
    const messages = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(directory, f), "utf8"))));
    assert.ok(messages.some((m) => m.purpose === "trial_started" && m.text.includes("72 ساعة") && m.text.includes("+972567508786")));
    assert.ok(messages.some((m) => m.purpose === "trial_started" && m.text.includes("72-hour") && m.text.includes("+972567508786")));
    assert.ok(messages.some((m) => m.purpose === "subscription_active" && m.text.includes("olive-store")));
    assert.ok(messages.some((m) => m.purpose === "subscription_expired" && m.text.includes("محفوظة بالكامل")));
    assert.ok(messages.some((m) => m.purpose === "subscription_expired" && m.text.includes("safely preserved")));
  } finally {
    for (const variable of ["DAR_ENV", "DAR_STAGING_LOCAL", "APP_ORIGIN", "MAIL_PROVIDER", "DAR_MAIL_DIR"]) {
      if (previous[variable] === undefined) delete process.env[variable];
      else process.env[variable] = previous[variable];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
