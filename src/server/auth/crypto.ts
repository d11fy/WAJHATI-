import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const options = { N: 32_768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
const format = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
export const dummyPasswordHash = `scrypt-v1$${"0".repeat(32)}$${"0".repeat(64)}`;

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const match = format.exec(encoded);
  if (!match) return false;
  const key = await derive(password, Buffer.from(match[1], "hex"));
  return timingSafeEqual(key, Buffer.from(match[2], "hex"));
}

export function randomSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function isSessionToken(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
