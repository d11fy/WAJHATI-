import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { validateEnv } from "../../scripts/ops/validate-env.mjs";
import { collect, compare, fingerprints, open, seal } from "../../scripts/ops/key-escrow.mjs";

const key = () => randomBytes(32).toString("hex");
const passphrase = "correct horse battery staple 2026!";

function liveKeys() {
  return {
    PLATFORM_MFA_KEY: key(), SMTP_CONFIG_KEY: key(), BACKUP_KEY_ID: "v2", BACKUP_KEY: key(),
    PAYMENT_PROOF_ACTIVE_KEY: "p2", PAYMENT_PROOF_KEYRING: JSON.stringify({ p1: key(), p2: key() }), BACKUP_KEYRING: JSON.stringify({ v1: key() }),
  };
}

test("sealed escrow restores every key, and the file never contains a plaintext key", async () => {
  const env = liveKeys();
  const held = collect(env);
  const sealed = await seal(held, passphrase);
  const text = JSON.stringify(sealed);
  for (const value of [env.PLATFORM_MFA_KEY, env.SMTP_CONFIG_KEY, env.BACKUP_KEY, ...Object.values<string>(JSON.parse(env.PAYMENT_PROOF_KEYRING)), ...Object.values<string>(JSON.parse(env.BACKUP_KEYRING))]) {
    assert.ok(!text.includes(value), "the sealed file must not contain a key in plaintext");
    assert.ok(!text.includes(Buffer.from(value).toString("base64")), "nor a base64 copy of a key");
  }
  assert.equal(sealed.format, "DAR-ESCROW-1");
  assert.equal(sealed.kdf.name, "scrypt");
  assert.deepEqual(await open(sealed, passphrase), held);
  // Fingerprints identify key versions without revealing them.
  const prints = fingerprints(held);
  assert.deepEqual(Object.keys(prints).sort(), ["BACKUP_KEY", "BACKUP_KEYRING.v1", "BACKUP_KEY_ID", "PAYMENT_PROOF_ACTIVE_KEY", "PAYMENT_PROOF_KEYRING.p1", "PAYMENT_PROOF_KEYRING.p2", "PLATFORM_MFA_KEY", "SMTP_CONFIG_KEY"]);
  for (const [name, print] of Object.entries(prints)) assert.match(print, /^[a-f0-9]{16}$/, name);
  assert.deepEqual(sealed.fingerprints, prints);
});

test("a wrong passphrase, an altered file or a weak passphrase is refused", async () => {
  const sealed = await seal(collect(liveKeys()), passphrase);
  await assert.rejects(open(sealed, "a completely different passphrase 123"), /could not be opened/);
  const flip = (text: string) => Buffer.from(Buffer.from(text, "base64").map((byte, index) => index === 0 ? byte ^ 1 : byte)).toString("base64");
  await assert.rejects(open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, passphrase), /could not be opened/);
  await assert.rejects(open({ ...sealed, tag: flip(sealed.tag) }, passphrase), /could not be opened/);
  // The header is authenticated: changing the recorded creation time or nonce breaks decryption too.
  await assert.rejects(open({ ...sealed, createdAt: "2001-01-01T00:00:00.000Z" }, passphrase), /could not be opened/);
  await assert.rejects(open({ ...sealed, format: "DAR-ESCROW-0" }, passphrase), /Unsupported/);
  await assert.rejects(seal(collect(liveKeys()), "short"), /at least 24 characters/);
});

test("escrow collection rejects malformed keys and an empty environment", () => {
  assert.throws(() => collect({}), /No application keys/);
  assert.throws(() => collect({ PLATFORM_MFA_KEY: "not-hex" }), /64 hex/);
  assert.throws(() => collect({ PAYMENT_PROOF_KEYRING: "{oops" }), /valid JSON/);
  assert.throws(() => collect({ PAYMENT_PROOF_KEYRING: JSON.stringify({ a: "short" }) }), /64-hex/);
});

test("verification reports which live keys match, changed, are missing or are not yet escrowed", () => {
  const env = liveKeys();
  const held = collect(env);
  assert.ok(Object.values(compare(held, env)).every((status) => status === "match"));
  const drifted = { ...env, SMTP_CONFIG_KEY: key(), BACKUP_KEYRING: undefined as unknown as string, PLATFORM_MFA_KEY: env.PLATFORM_MFA_KEY, PAYMENT_PROOF_KEYRING: JSON.stringify({ p1: JSON.parse(env.PAYMENT_PROOF_KEYRING).p1, p3: key() }) };
  const status = compare(held, drifted) as Record<string, string>;
  assert.equal(status.SMTP_CONFIG_KEY, "changed");
  assert.equal(status["BACKUP_KEYRING.v1"], "missing");
  assert.equal(status["PAYMENT_PROOF_KEYRING.p1"], "match");
  assert.equal(status["PAYMENT_PROOF_KEYRING.p2"], "missing");
  assert.equal(status["PAYMENT_PROOF_KEYRING.p3"], "not-in-escrow");
});

test("backup environment accepts the media source, freshness and heartbeat settings only when safe", () => {
  const base = { DAR_ENV: "production", PUBLIC_SIGNUP_ENABLED: "false", BACKUP_DATABASE_URL: "postgresql://backup:fixture@db/dar_production", BACKUP_DIR: "/backups",
    BACKUP_KEY_ID: "v1", BACKUP_KEY: key(), BACKUP_BUCKET: "dar-production-backup-fixture", BACKUP_AWS_ACCESS_KEY_ID: "id", BACKUP_AWS_SECRET_ACCESS_KEY: "secret",
    BACKUP_S3_ENDPOINT: "https://storage.example.test" };
  assert.deepEqual(validateEnv(base, "backup"), []);
  const media = { BACKUP_SOURCE_BUCKET: "dar-production-media-fixture", BACKUP_SOURCE_AWS_ACCESS_KEY_ID: "ro", BACKUP_SOURCE_AWS_SECRET_ACCESS_KEY: "ro-secret", BACKUP_SOURCE_S3_ENDPOINT: "https://storage.example.test" };
  assert.deepEqual(validateEnv({ ...base, ...media }, "backup"), []);
  assert.ok(validateEnv({ ...base, ...media, BACKUP_SOURCE_AWS_SECRET_ACCESS_KEY: "" }, "backup").includes("BACKUP_SOURCE_AWS_SECRET_ACCESS_KEY"));
  assert.ok(validateEnv({ ...base, ...media, BACKUP_SOURCE_BUCKET: "dar-production-backup-fixture" }, "backup").includes("BACKUP_SOURCE_BUCKET"));
  assert.ok(validateEnv({ ...base, ...media, BACKUP_SOURCE_BUCKET: "some-other-bucket" }, "backup").includes("BACKUP_SOURCE_BUCKET"));
  assert.ok(validateEnv({ ...base, ...media, BACKUP_SOURCE_S3_ENDPOINT: "http://storage.example.test" }, "backup").includes("BACKUP_SOURCE_S3_ENDPOINT"));
  assert.ok(validateEnv({ ...base, DAR_HEARTBEAT_URL: "http://monitor.example.test/ping" }, "backup").includes("DAR_HEARTBEAT_URL"));
  assert.ok(validateEnv({ ...base, DAR_HEARTBEAT_URL: "https://user:pass@monitor.example.test/ping" }, "backup").includes("DAR_HEARTBEAT_URL"));
  assert.deepEqual(validateEnv({ ...base, DAR_HEARTBEAT_URL: "https://monitor.example.test/ping/abc", BACKUP_MAX_AGE_HOURS: "30" }, "backup"), []);
  for (const bad of ["0", "-1", "abc", "500"]) assert.ok(validateEnv({ ...base, BACKUP_MAX_AGE_HOURS: bad }, "backup").includes("BACKUP_MAX_AGE_HOURS"), bad);
  // Application keys must never sit in the backup environment.
  assert.ok(validateEnv({ ...base, PLATFORM_MFA_KEY: key() }, "backup").includes("PLATFORM_MFA_KEY"));
});
