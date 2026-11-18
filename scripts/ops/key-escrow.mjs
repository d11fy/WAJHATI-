// Key escrow: seal the application keys that decrypt data inside the backups (MFA seeds, stored payment proofs, the SMTP
// password and the backup keyring itself) under a passphrase that is held somewhere else.
//
// The database dump restores without these keys but is then partly unreadable. The keys must never travel in a backup in
// plaintext, so they are sealed here with AES-256-GCM under a key derived with scrypt from a passphrase. The escrow file
// is safe to store next to the backups; the passphrase must not be stored there.
//
//   seal    reads the keys from the environment of the process running it, writes the sealed file.
//   verify  decrypts a sealed file and compares fingerprints with the live environment (nothing is printed but status).
//   open    decrypts a sealed file into a new env file (mode 0600) for loading into a secret store during recovery.
//
// The passphrase comes only from ESCROW_PASSPHRASE_FILE (a file path) or ESCROW_PASSPHRASE, never from an argument, and
// must be at least 24 characters. Key values are never printed.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const escrowFormat = "DAR-ESCROW-1";
const scalarNames = ["PLATFORM_MFA_KEY", "SMTP_CONFIG_KEY", "PAYMENT_PROOF_KEY", "PAYMENT_PROOF_ACTIVE_KEY", "BACKUP_KEY_ID", "BACKUP_KEY"];
const ringNames = ["PAYMENT_PROOF_KEYRING", "BACKUP_KEYRING"];
const hex = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const kdf = { name: "scrypt", N: 131072, r: 8, p: 1 };

function derive(passphrase, salt) {
  return new Promise((resolve, reject) => scrypt(passphrase, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}

export function checkPassphrase(value) {
  if (typeof value !== "string" || value.trim().length < 24) throw new Error("The escrow passphrase must be at least 24 characters.");
  return value.trim();
}

export async function readPassphrase(env = process.env) {
  if (env.ESCROW_PASSPHRASE_FILE) return checkPassphrase(await readFile(env.ESCROW_PASSPHRASE_FILE, "utf8"));
  return checkPassphrase(env.ESCROW_PASSPHRASE);
}

/** The keys present in an environment, validated. Ring values are JSON objects of id to 64-hex key. */
export function collect(env) {
  const keys = {};
  for (const name of scalarNames) if (env[name]) keys[name] = env[name];
  for (const name of ringNames) {
    if (!env[name]) continue;
    let ring;
    try { ring = JSON.parse(env[name]); } catch { throw new Error(`${name} is not valid JSON.`); }
    if (!ring || typeof ring !== "object" || Array.isArray(ring) || !Object.values(ring).every(hex)) throw new Error(`${name} must map key ids to 64-hex keys.`);
    keys[name] = JSON.stringify(Object.fromEntries(Object.entries(ring).sort(([a], [b]) => a.localeCompare(b))));
  }
  for (const name of ["PLATFORM_MFA_KEY", "SMTP_CONFIG_KEY", "PAYMENT_PROOF_KEY", "BACKUP_KEY"]) if (keys[name] && !hex(keys[name])) throw new Error(`${name} must be 64 hex characters.`);
  if (!Object.keys(keys).length) throw new Error("No application keys are present in this environment.");
  return keys;
}

/** Short one-way fingerprints: they identify which key version is held without revealing it. */
export function fingerprints(keys) {
  const tag = (value) => createHmac("sha256", "dar-escrow-fingerprint-v1").update(value).digest("hex").slice(0, 16);
  const result = {};
  for (const [name, value] of Object.entries(keys)) {
    if (ringNames.includes(name)) for (const [id, key] of Object.entries(JSON.parse(value))) result[`${name}.${id}`] = tag(key);
    else result[name] = tag(value);
  }
  return result;
}

const aad = (header) => Buffer.from(JSON.stringify({ format: header.format, createdAt: header.createdAt, kdf: header.kdf, nonce: header.nonce }));

export async function seal(keys, passphrase, now = new Date()) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const header = { format: escrowFormat, createdAt: now.toISOString(), kdf: { ...kdf, salt: salt.toString("hex") }, nonce: nonce.toString("hex") };
  const cipher = createCipheriv("aes-256-gcm", await derive(checkPassphrase(passphrase), salt), nonce);
  cipher.setAAD(aad(header));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(keys), "utf8"), cipher.final()]);
  return { ...header, ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64"), fingerprints: fingerprints(keys) };
}

export async function open(sealed, passphrase) {
  if (sealed?.format !== escrowFormat || sealed.kdf?.name !== "scrypt" || sealed.kdf.N !== kdf.N || sealed.kdf.r !== kdf.r || sealed.kdf.p !== kdf.p) throw new Error("Unsupported escrow file.");
  const decipher = createDecipheriv("aes-256-gcm", await derive(checkPassphrase(passphrase), Buffer.from(sealed.kdf.salt, "hex")), Buffer.from(sealed.nonce, "hex"));
  decipher.setAAD(aad(sealed));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  try {
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8"));
  } catch { throw new Error("The escrow file could not be opened. The passphrase is wrong or the file was altered."); }
}

/** Compare held keys with a live environment. Returns one status per fingerprint. */
export function compare(held, env) {
  const live = fingerprints(collect(env));
  const want = fingerprints(held);
  const status = {};
  for (const name of Object.keys(want)) status[name] = !(name in live) ? "missing" : live[name] === want[name] ? "match" : "changed";
  for (const name of Object.keys(live)) if (!(name in want)) status[name] = "not-in-escrow";
  return status;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const mode = process.argv[2];
  if (mode === "seal") {
    const out = argument("--out");
    if (!out) throw new Error("--out <file> is required.");
    const keys = collect(process.env);
    const sealed = await seal(keys, await readPassphrase());
    await writeFile(out, JSON.stringify(sealed, null, 2), { flag: "wx", mode: 0o600 });
    if (process.argv.includes("--upload")) {
      const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
      const storage = new S3Client({ endpoint: process.env.BACKUP_S3_ENDPOINT || undefined, region: process.env.BACKUP_REGION ?? "us-east-1",
        forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === "true",
        credentials: { accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY ?? "" },
        requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
      try {
        await storage.send(new PutObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: `escrow/escrow-${sealed.createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`,
          Body: JSON.stringify(sealed), ContentType: "application/json" }));
      } finally { storage.destroy(); }
    }
    console.log(JSON.stringify({ event: "escrow_sealed", keys: Object.keys(sealed.fingerprints).length, file: out, uploaded: process.argv.includes("--upload") }));
  } else if (mode === "verify") {
    const held = await open(JSON.parse(await readFile(argument("--in") ?? "", "utf8")), await readPassphrase());
    const status = compare(held, process.env);
    console.log(JSON.stringify({ event: "escrow_verified", status }));
    if (Object.values(status).some((value) => value !== "match")) process.exitCode = 1;
  } else if (mode === "open") {
    const out = argument("--out");
    if (!out) throw new Error("--out <env-file> is required.");
    const held = await open(JSON.parse(await readFile(argument("--in") ?? "", "utf8")), await readPassphrase());
    await writeFile(out, Object.entries(held).map(([name, value]) => `${name}='${value}'`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ event: "escrow_opened", keys: Object.keys(held).length, file: out, note: "Load into the secret store, then securely delete this file." }));
  } else {
    process.exitCode = 2;
    console.error("Usage: key-escrow.mjs seal --out <file> [--upload] | verify --in <file> | open --in <file> --out <env-file>");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(JSON.stringify({ event: "escrow_failed", reason: error.message })); process.exitCode = 1; });
}
