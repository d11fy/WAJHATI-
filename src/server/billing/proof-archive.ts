import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type ProofArchive = { cipher: Buffer; originalType: string; sha256: string; keyId?: string | null };
const validKey = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const validId = (value: string) => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(value);

function configuredKeys() {
  const text = process.env.PAYMENT_PROOF_KEYRING;
  const active = process.env.PAYMENT_PROOF_ACTIVE_KEY;
  if (!text && !active) return { keys: null, active: null };
  const keys = JSON.parse(text ?? "null") as Record<string, unknown> | null;
  if (!keys || typeof keys !== "object" || Array.isArray(keys) || !active || !validId(active) ||
    !Object.hasOwn(keys, active) || !Object.entries(keys).every(([id, value]) => validId(id) && validKey(value))) {
    throw new Error("Invalid proof key configuration.");
  }
  return { keys, active };
}

function keyFor(id: string | null) {
  const value = id === null ? process.env.PAYMENT_PROOF_KEY : configuredKeys().keys?.[id];
  if (!validKey(value)) throw new Error("Proof encryption key unavailable.");
  return Buffer.from(value, "hex");
}

export function proofKeyReady() {
  try { keyFor(configuredKeys().active); return true; }
  catch { return false; }
}

const associated = (id: string, type: string, key: string | null) =>
  Buffer.from(key === null ? `dar-proof-v1:${id.toLowerCase()}:${type}` : `dar-proof-v2:${key}:${id.toLowerCase()}:${type}`);

export function sealProof(id: string, original: Buffer, originalType: string): ProofArchive {
  const keyId = configuredKeys().active;
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(keyId), nonce);
  cipher.setAAD(associated(id, originalType, keyId));
  const body = Buffer.concat([cipher.update(original), cipher.final()]);
  return { cipher: Buffer.concat([nonce, cipher.getAuthTag(), body]), originalType, sha256: createHash("sha256").update(original).digest("hex"), keyId };
}

export function openProof(id: string, archive: ProofArchive) {
  const keyId = archive.keyId ?? null;
  const decipher = createDecipheriv("aes-256-gcm", keyFor(keyId), archive.cipher.subarray(0, 12));
  decipher.setAAD(associated(id, archive.originalType, keyId));
  decipher.setAuthTag(archive.cipher.subarray(12, 28));
  const content = Buffer.concat([decipher.update(archive.cipher.subarray(28)), decipher.final()]);
  if (createHash("sha256").update(content).digest("hex") !== archive.sha256) throw new Error("Proof integrity check failed.");
  return content;
}
