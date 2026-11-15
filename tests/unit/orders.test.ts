import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalOptions, cartInput, changeQuantity, contactLinks, emptyContact, lineKey, mergeCart, orderMessage, orderTotal, whatsappTarget, type CartLine } from "../../src/lib/checkout";
import { validateContact } from "../../src/server/orders/merchant";

const line: CartLine = { product: "coffee", quantity: 2, options: [{ group: "الحجم", value: "كبير" }, { group: "Color", value: "Blue" }] };

test("cart merges only matching variants, updates quantities and removes lines", () => {
  const same = { ...line, options: [...line.options].reverse() };
  const different = { ...line, options: [line.options[0], { group: "Color", value: "Red" }] };
  const first = mergeCart([line], same);
  assert.equal(first?.[0].quantity, 4);
  assert.equal(mergeCart(first!, different)?.length, 2);
  assert.equal(changeQuantity(first!, lineKey(line), 8)[0].quantity, 8);
  assert.deepEqual(changeQuantity(first!, lineKey(line), 0), []);
  assert.equal(mergeCart([{ ...line, quantity: 20 }], line), null);
  assert.equal(cartInput.safeParse([{ ...line, price: 1 }]).success, false);
  assert.equal(cartInput.safeParse([line, same]).success, false);
});

test("one valid choice per current option group is required", () => {
  const groups = [{ name: "الحجم", values: ["كبير"] }, { name: "Color", values: ["Blue", "Red"] }];
  assert.deepEqual(canonicalOptions([...line.options].reverse(), groups), line.options);
  assert.equal(canonicalOptions([line.options[0]], groups), null);
  assert.equal(canonicalOptions([line.options[0], line.options[0]], groups), null);
  assert.equal(canonicalOptions([line.options[0], { group: "Color", value: "Green" }], groups), null);
});

test("integer totals and encoded WhatsApp summaries preserve mixed text and currency precision", () => {
  const priced = { ...line, nameAr: "قهوة A&B #1", nameEn: "Coffee + cardamom", unitMinor: 12345, imageId: null };
  const total = orderTotal([priced]);
  assert.equal(total, 24690);
  const message = orderMessage({ locale: "ar", name: "دار + Shop", currency: "JOD", lines: [priced], total, reference: "DM-REF", greeting: "مرحبًا & hello" });
  const url = new URL(whatsappTarget("+12025550123", message, "DM-REF", "ar")!.url);
  assert.equal(url.hostname, "wa.me");
  assert.equal(url.searchParams.get("text"), message);
  assert.match(message, /24\.690|٢٤٫٦٩٠/);
  const en = orderMessage({ locale: "en", name: "Shop", currency: "USD", lines: [{ ...priced, unitMinor: 1234 }], total: 2468, greeting: "" });
  assert.match(en, /24\.68/);
  const long = whatsappTarget("+12025550123", "ع".repeat(4000), "DM-REF", "ar")!;
  assert.ok(long.short && long.url.length < 1800);
  assert.match(new URL(long.url).searchParams.get("text")!, /DM-REF/);
});

test("invalid destinations and disabled defaults are rejected", () => {
  const valid = { ...emptyContact, enabled: true, whatsapp: true, instagram: true, defaultChannel: "whatsapp", phone: "+12025550123", handle: "dar.market" };
  assert.ok(validateContact(valid));
  assert.equal(validateContact({ ...valid, phone: "+99912345678" }), null);
  assert.equal(validateContact({ ...valid, whatsapp: false }), null);
  assert.equal(validateContact({ ...valid, handle: "evil.com/path" }), null);
  assert.equal(contactLinks(validateContact(valid)!).instagram, "https://www.instagram.com/dar.market/");
  assert.equal(whatsappTarget("+1?next=https://evil.invalid", "x", "DM", "en"), null);
});
