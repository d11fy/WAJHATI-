import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocale, otherLocale } from "../../src/lib/i18n";
import { signUpInput, storeInput } from "../../src/lib/validation";
import { digest, hashPassword, isSessionToken, randomSessionToken, verifyPassword } from "../../src/server/auth/crypto";

test("normalizes email and display name while preserving the exact password", () => {
  const password = "  twelve chars  ";
  assert.deepEqual(signUpInput.parse({ name: "  نور ", email: " OWNER@EXAMPLE.COM ", password }), {
    name: "نور", email: "owner@example.com", password,
  });
  assert.equal(signUpInput.safeParse({ name: "نور", email: "owner@example.com", password: "short" }).success, false);
});

test("validates store route and market data and strips untrusted keys", () => {
  const input = { name: "متجر الزيتون", slug: " Olive-House ", country: "PS", currency: "JOD" };
  assert.deepEqual(storeInput.parse({ ...input, userId: "injected", role: "owner" }), { ...input, slug: "olive-house" });
  for (const slug of ["a", "../another", "a--b", "-abc", "abc-", "عربي", "x".repeat(49)]) {
    assert.equal(storeInput.safeParse({ ...input, slug }).success, false, slug);
  }
  assert.equal(storeInput.safeParse({ ...input, country: "XX" }).success, false);
  assert.equal(storeInput.safeParse({ ...input, currency: "AAA" }).success, false);
  assert.equal(storeInput.safeParse({ ...input, name: "🌿" }).success, false);
  assert.equal(storeInput.safeParse({ ...input, name: "abc\u0000" }).success, false);
});

test("recognizes the two supported route locales", () => {
  assert.equal(isLocale("ar"), true);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(otherLocale("ar"), "en");
  assert.equal(otherLocale("en"), "ar");
});

test("password hashes are salted and verify only the exact password", async () => {
  const password = "كلمة مرور طويلة وآمنة";
  const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
  assert.notEqual(first, second);
  assert.ok(await verifyPassword(password, first));
  assert.equal(await verifyPassword(`${password} `, first), false);
  assert.equal(await verifyPassword(password, "invalid"), false);
});

test("session tokens have the expected format and produce distinct fixed-length digests", () => {
  const first = randomSessionToken();
  const second = randomSessionToken();
  assert.ok(isSessionToken(first));
  assert.equal(isSessionToken(first.slice(1)), false);
  assert.equal(isSessionToken(undefined), false);
  assert.match(digest(first), /^[0-9a-f]{64}$/);
  assert.notEqual(digest(first), digest(second));
});
