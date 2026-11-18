import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { validateEnv } from "../../scripts/ops/validate-env.mjs";
import { sendIdentityMail, sendOperationsMail } from "../../src/server/auth/mail";
import { openProof, sealProof } from "../../src/server/billing/proof-archive";
import { socketRenderer } from "../../src/server/billing/pdf-socket";
import { receiptPdf } from "../fixtures/receipt.mjs";

const key = () => randomBytes(32).toString("hex");

test("production validation fails closed for local mail, privileged credentials and shared roles", () => {
  const env = { DAR_ENV: "production", PUBLIC_SIGNUP_ENABLED: "false", LEGAL_APPROVED: "true", APP_ORIGIN: "https://example.test",
    DATABASE_URL: "postgresql://runtime:fixture-one@db/dar_production", IDENTITY_DATABASE_URL: "postgresql://identity:fixture-two@db/dar_production",
    PLATFORM_MFA_KEY: key(), OPS_METRICS_TOKEN: key(), PAYMENT_PROOF_KEYRING: JSON.stringify({ v2: key() }), PAYMENT_PROOF_ACTIVE_KEY: "v2",
    PAYMENT_RENDERER_SOCKET: "/run/dar-pdf/worker.sock", TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
    S3_BUCKET: "dar-production-media-fixture", S3_READY_KEY: "ops/readiness", MAIL_PROVIDER: "resend", MAIL_FROM: "mail@example.test", RESEND_API_KEY: "fixture" };
  assert.deepEqual(validateEnv(env), []);
  const invalid = validateEnv({ ...env, IDENTITY_DATABASE_URL: env.DATABASE_URL, MAIL_PROVIDER: "local", PUBLIC_SIGNUP_ENABLED: "true",
    MIGRATION_DATABASE_URL: env.DATABASE_URL, S3_ENDPOINT: "http://example.test", PAYMENT_RENDERER_SOCKET: "" });
  for (const field of ["DATABASE_ROLE_ISOLATION", "MAIL_PROVIDER", "PUBLIC_SIGNUP_ENABLED", "MIGRATION_DATABASE_URL", "S3_ENDPOINT", "PAYMENT_RENDERER_SOCKET"]) assert.ok(invalid.includes(field));
});

test("production refuses to start while the legal documents are unapproved, but staging and development do not", () => {
  const env = { DAR_ENV: "production", PUBLIC_SIGNUP_ENABLED: "false", APP_ORIGIN: "https://example.test",
    DATABASE_URL: "postgresql://runtime:fixture-one@db/dar_production", IDENTITY_DATABASE_URL: "postgresql://identity:fixture-two@db/dar_production",
    PLATFORM_MFA_KEY: key(), OPS_METRICS_TOKEN: key(), PAYMENT_PROOF_KEYRING: JSON.stringify({ v2: key() }), PAYMENT_PROOF_ACTIVE_KEY: "v2",
    PAYMENT_RENDERER_SOCKET: "/run/dar-pdf/worker.sock", TRUSTED_CLIENT_IP_HEADER: "x-real-ip",
    S3_BUCKET: "dar-production-media-fixture", S3_READY_KEY: "ops/readiness", MAIL_PROVIDER: "resend", MAIL_FROM: "mail@example.test", RESEND_API_KEY: "fixture" };
  assert.deepEqual(validateEnv(env), ["LEGAL_APPROVED"]);
  assert.deepEqual(validateEnv({ ...env, LEGAL_APPROVED: "false" }), ["LEGAL_APPROVED"]);
  assert.deepEqual(validateEnv({ ...env, LEGAL_APPROVED: "true" }), []);
  assert.ok(!validateEnv({ ...env, DAR_ENV: "staging", DATABASE_URL: "postgresql://runtime:fixture-one@db/dar_staging", IDENTITY_DATABASE_URL: "postgresql://identity:fixture-two@db/dar_staging", S3_BUCKET: "dar-staging-media-fixture" }).includes("LEGAL_APPROVED"));
});

test("proof key rotation keeps legacy and previous versions readable", () => {
  process.env.PAYMENT_PROOF_KEY = key();
  const id = randomUUID(), original = Buffer.from("synthetic proof");
  const legacy = sealProof(id, original, "application/pdf");
  const old = key(), active = key();
  process.env.PAYMENT_PROOF_KEYRING = JSON.stringify({ old });
  process.env.PAYMENT_PROOF_ACTIVE_KEY = "old";
  const previous = sealProof(id, original, "application/pdf");
  process.env.PAYMENT_PROOF_KEYRING = JSON.stringify({ old, active });
  process.env.PAYMENT_PROOF_ACTIVE_KEY = "active";
  const newest = sealProof(id, original, "application/pdf");
  assert.equal(newest.keyId, "active");
  for (const archive of [legacy, previous, newest]) assert.deepEqual(openProof(id, archive), original);
  assert.throws(() => openProof(id, { ...previous, keyId: "active" }));
});

test("PDF worker returns all accepted pages over a local socket and rejects oversized page counts", async (t) => {
  const id = randomUUID();
  const socket = process.platform === "win32" ? `\\\\.\\pipe\\dar-pdf-${id}` : `/tmp/dar-pdf-${id}.sock`;
  const child = spawn(process.execPath, ["scripts/ops/pdf-worker.mjs"], {
    env: { ...process.env, PAYMENT_RENDERER_SOCKET: socket, DAR_LOCAL_PDF: "true" }, stdio: "ignore", windowsHide: true,
  });
  t.after(() => { child.kill(); });
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    ready = await socketRenderer(socket).then((response) => response.ok, () => false);
    if (!ready) await delay(100);
  }
  assert.ok(ready);
  const preview = await socketRenderer(socket, receiptPdf(["one", "two", "three"]));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/webp");
  assert.equal(preview.headers.get("x-rendered-pages"), "3");
  const image = sharp(Buffer.from(await preview.arrayBuffer()));
  const { width, height } = await image.metadata();
  assert.equal(height, 1440);
  for (const top of [0, 480, 960]) {
    const page = await image.clone().extract({ left: 0, top, width, height: 480 }).toBuffer();
    assert.ok((await sharp(page).greyscale().stats()).channels[0].min < 200);
  }
  assert.equal((await socketRenderer(socket, receiptPdf(["1", "2", "3", "4"]))).status, 415);
  assert.equal((await socketRenderer(socket, Buffer.from("not a pdf"))).status, 415);
});

test("local inbox covers bilingual identity and idempotent operational messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dar-mail-test-"));
  const previous = { ...process.env };
  Object.assign(process.env, { DAR_ENV: "staging", DAR_STAGING_LOCAL: "true", APP_ORIGIN: "https://localhost:8443", MAIL_PROVIDER: "local", DAR_MAIL_DIR: directory });
  try {
    for (const purpose of ["verify", "reset", "change_old", "change_new"] as const) {
      await sendIdentityMail(purpose === "change_new" ? "en" : "ar", `${purpose}@example.test`, purpose, randomUUID());
    }
    const reminder = randomUUID();
    assert.equal(await sendOperationsMail("ar", "merchant@example.test", "billing_due", reminder, "sample-store"), "sent");
    assert.equal(await sendOperationsMail("ar", "merchant@example.test", "billing_due", reminder, "sample-store"), "sent");
    await sendOperationsMail("en", "reviewer@example.test", "review_pending", randomUUID(), null);
    const files = await readdir(directory);
    const mail = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8"))));
    assert.deepEqual(mail.map(({ purpose }) => purpose).sort(), ["billing_due", "change_new", "change_old", "reset", "review_pending", "verify"]);
    assert.ok(mail.find(({ purpose }) => purpose === "change_new").url.startsWith("https://localhost:8443/en/identity/change_new#token="));
    assert.ok(mail.find(({ purpose }) => purpose === "change_old").url.startsWith("https://localhost:8443/ar/identity/change_old#token="));
    assert.equal(new URL(mail.find(({ purpose }) => purpose === "review_pending").url).hash, "");
  } finally {
    for (const variable of ["DAR_ENV", "DAR_STAGING_LOCAL", "APP_ORIGIN", "MAIL_PROVIDER", "DAR_MAIL_DIR"]) {
      if (previous[variable] === undefined) delete process.env[variable];
      else process.env[variable] = previous[variable];
    }
    await rm(directory, { recursive: true, force: true });
  }
});
