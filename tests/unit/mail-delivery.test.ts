import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateEnv } from "../../scripts/ops/validate-env.mjs";
import { parseAllowlist, recipientAllowed } from "../../src/lib/mail-guard";

const key = () => randomBytes(32).toString("hex");
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function appEnv(environment: "production" | "staging", extra: Record<string, string> = {}) {
  const db = `dar_${environment}`;
  return {
    DAR_ENV: environment, PUBLIC_SIGNUP_ENABLED: "false", APP_ORIGIN: "https://example.test", ...(environment === "production" ? { LEGAL_APPROVED: "true" } : {}),
    DATABASE_URL: `postgresql://runtime:fixture-one@db/${db}`, IDENTITY_DATABASE_URL: `postgresql://identity:fixture-two@db/${db}`,
    PLATFORM_MFA_KEY: key(), OPS_METRICS_TOKEN: key(), PAYMENT_PROOF_KEYRING: JSON.stringify({ v2: key() }), PAYMENT_PROOF_ACTIVE_KEY: "v2",
    PAYMENT_RENDERER_SOCKET: "/run/dar-pdf/worker.sock", TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
    S3_BUCKET: `dar-${environment}-media-fixture`, S3_READY_KEY: "ops/readiness", SMTP_CONFIG_KEY: key(), ...extra,
  };
}
function mailerEnv(environment: "production" | "staging", extra: Record<string, string> = {}) {
  return { DAR_ENV: environment, PUBLIC_SIGNUP_ENABLED: "false", APP_ORIGIN: "https://example.test",
    MAIL_WORKER_DATABASE_URL: `postgresql://mailer:fixture-three@db/dar_${environment}`, SMTP_CONFIG_KEY: key(), ...extra };
}

test("Resend is optional: owner-managed SMTP alone satisfies the app and the mail delivery process", () => {
  assert.deepEqual(validateEnv(appEnv("production")), []);
  assert.deepEqual(validateEnv(mailerEnv("production"), "mailer"), []);
  // Resend alone, both together, and incomplete Resend.
  const resend = { MAIL_PROVIDER: "resend", RESEND_API_KEY: "fixture", MAIL_FROM: "mail@example.test" };
  assert.deepEqual(validateEnv(appEnv("production", { ...resend, SMTP_CONFIG_KEY: "" })), []);
  assert.deepEqual(validateEnv(appEnv("production", resend)), []);
  assert.ok(validateEnv(appEnv("production", { MAIL_PROVIDER: "resend", SMTP_CONFIG_KEY: "" })).includes("RESEND_API_KEY"));
  // No provider at all, an unknown provider, a malformed key and a reused key are rejected.
  assert.ok(validateEnv(appEnv("production", { SMTP_CONFIG_KEY: "" })).includes("MAIL_PROVIDER"));
  assert.ok(validateEnv(appEnv("production", { MAIL_PROVIDER: "local" })).includes("MAIL_PROVIDER"));
  assert.ok(validateEnv(appEnv("production", { SMTP_CONFIG_KEY: "short" })).includes("SMTP_CONFIG_KEY"));
  const app = appEnv("production");
  assert.ok(validateEnv({ ...app, SMTP_CONFIG_KEY: app.PLATFORM_MFA_KEY }).includes("SMTP_CONFIG_KEY"));
});

test("each process holds only its own credentials", () => {
  const mailer = mailerEnv("production");
  // The mailer must not carry any other database login, the identity or proof keys, or storage credentials.
  for (const [name, value] of Object.entries({
    DATABASE_URL: "postgresql://runtime:fixture-one@db/dar_production", IDENTITY_DATABASE_URL: "postgresql://identity:fixture-two@db/dar_production",
    MEDIA_WORKER_DATABASE_URL: "postgresql://worker:fixture-four@db/dar_production", PLATFORM_MFA_KEY: key(), AWS_SECRET_ACCESS_KEY: "x", BACKUP_KEY: key(),
    PAYMENT_PROOF_KEYRING: "{}",
  })) assert.ok(validateEnv({ ...mailer, [name]: value }, "mailer").includes(name), `mailer must reject ${name}`);
  assert.ok(validateEnv({ ...mailer, MAIL_WORKER_DATABASE_URL: "" }, "mailer").includes("MAIL_WORKER_DATABASE_URL"));
  assert.ok(validateEnv({ ...mailer, MAIL_WORKER_DATABASE_URL: "postgresql://mailer:fixture@db/dar_staging" }, "mailer").includes("MAIL_WORKER_DATABASE_URL"), "database name must match the environment");
  // The media worker must not hold mail secrets or the mailer login, and the app must not hold the mailer login.
  const worker = { DAR_ENV: "production", PUBLIC_SIGNUP_ENABLED: "false", APP_ORIGIN: "https://example.test",
    MEDIA_WORKER_DATABASE_URL: "postgresql://worker:fixture-four@db/dar_production", S3_BUCKET: "dar-production-media-fixture" };
  assert.deepEqual(validateEnv(worker, "worker"), []);
  for (const name of ["SMTP_CONFIG_KEY", "RESEND_API_KEY", "MAIL_WORKER_DATABASE_URL"]) {
    assert.ok(validateEnv({ ...worker, [name]: name === "SMTP_CONFIG_KEY" ? key() : "postgresql://mailer:fixture-three@db/dar_production" }, "worker").includes(name), `worker must reject ${name}`);
  }
  assert.ok(validateEnv(appEnv("production", { MAIL_WORKER_DATABASE_URL: "postgresql://mailer:fixture-three@db/dar_production" })).includes("MAIL_WORKER_DATABASE_URL"));
});

test("a deployed staging environment may only email an explicit allow-list, and production may not set one", () => {
  assert.ok(validateEnv(appEnv("staging"), "app").includes("MAIL_ALLOWED_RECIPIENTS"));
  assert.ok(validateEnv(mailerEnv("staging"), "mailer").includes("MAIL_ALLOWED_RECIPIENTS"));
  for (const bad of ["not an address", "a@b", "*", "@", "x@@example.test"]) assert.ok(validateEnv(appEnv("staging", { MAIL_ALLOWED_RECIPIENTS: bad })).includes("MAIL_ALLOWED_RECIPIENTS"), bad);
  assert.deepEqual(validateEnv(appEnv("staging", { MAIL_ALLOWED_RECIPIENTS: "qa@example.test, @example.org" })), []);
  assert.deepEqual(validateEnv(mailerEnv("staging", { MAIL_ALLOWED_RECIPIENTS: "qa@example.test" }), "mailer"), []);
  assert.ok(validateEnv(appEnv("production", { MAIL_ALLOWED_RECIPIENTS: "qa@example.test" })).includes("MAIL_ALLOWED_RECIPIENTS"));
});

test("the recipient guard never lets staging mail reach anyone outside the allow-list", () => {
  const staging = { DAR_ENV: "staging", MAIL_ALLOWED_RECIPIENTS: "QA@Example.test, @example.org" };
  assert.deepEqual(parseAllowlist(staging.MAIL_ALLOWED_RECIPIENTS), ["qa@example.test", "@example.org"]);
  assert.equal(recipientAllowed("qa@example.test", "smtp", staging), true);
  assert.equal(recipientAllowed("anyone@example.org", "resend", staging), true);
  assert.equal(recipientAllowed("merchant@example.com", "smtp", staging), false);
  assert.equal(recipientAllowed("qa@example.test.evil.com", "smtp", staging), false);
  assert.equal(recipientAllowed("xqa@example.test", "smtp", staging), false);
  assert.equal(recipientAllowed("someone@notexample.org", "smtp", staging), false);
  // No list in staging blocks everything that leaves the machine; the local file sink is always safe.
  assert.equal(recipientAllowed("qa@example.test", "smtp", { DAR_ENV: "staging" }), false);
  assert.equal(recipientAllowed("merchant@example.com", "local", { DAR_ENV: "staging" }), true);
  // Production ignores the list; development enforces one only when set.
  assert.equal(recipientAllowed("merchant@example.com", "smtp", { DAR_ENV: "production", MAIL_ALLOWED_RECIPIENTS: "qa@example.test" }), true);
  assert.equal(recipientAllowed("merchant@example.com", "smtp", { DAR_ENV: "development" }), true);
  assert.equal(recipientAllowed("merchant@example.com", "smtp", { DAR_ENV: "development", MAIL_ALLOWED_RECIPIENTS: "qa@example.test" }), false);
});

test("decrypted SMTP passwords are never logged or returned, and queued mail runs through the mailer login only", () => {
  const mail = read("src/server/auth/mail.ts");
  const contact = read("src/server/platform/contact.ts");
  // The only place the password is opened is the transport call; nothing passes it to a logger.
  assert.equal(mail.match(/openSmtpPassword\(/g)?.length, 2);
  assert.doesNotMatch(mail, /console\.\w+\([^)]*(password|cipher|secret)/i);
  assert.doesNotMatch(read("src/server/auth/smtp.ts"), /console\./);
  // The platform view API never returns the cipher.
  assert.match(read("drizzle/0026_contact_subscription_access.sql"), /platform_mail_view[\s\S]{0,400}'hasPassword',true/);
  // The notification job runs as the mailer, with job logging through the notifications-only wrappers.
  const job = read("scripts/catalog-cleanup.ts");
  assert.match(job, /MAIL_WORKER_DATABASE_URL/);
  assert.match(job, /ops_mail_job_start/);
  assert.match(contact, /ops_mail_secret/);
  // The new migration grants the secret only to the mailer group.
  const sql = read("drizzle/0027_mail_delivery_role.sql");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.ops_mail_secret\(\)[^;]*TO storefront_mailer;/);
  assert.doesNotMatch(sql, /ops_mail_secret[^;]*TO (storefront_app|storefront_identity|storefront_media_worker|PUBLIC)/);
});
