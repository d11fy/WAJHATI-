import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { registrationAvailable, requestPayment, reviewPayment } from "../../src/lib/billing";
import { parseMinor, priceInput } from "../../src/lib/catalog";
import { readPaymentProof } from "../../src/server/billing/proof";
import { receiptPdf } from "../fixtures/receipt.mjs";

const upload = (body: Buffer, type: string) => new Request("http://localhost", {
  method: "POST", headers: { "Content-Type": type }, body: new Uint8Array(body),
});

test("billing uses exact 0, 2 and 3 decimal amounts and rejects excess precision", () => {
  assert.equal(parseMinor("600", "DJF"), 600);
  assert.equal(parseMinor("600.00", "DJF"), null);
  assert.equal(parseMinor("19.99", "USD"), 1999);
  assert.equal(parseMinor("١٢٫٣٤٥", "JOD"), 12345);
  assert.equal(priceInput(12345, "JOD"), "12.345");
  assert.equal(parseMinor("12.345", "USD"), null);
  assert.ok(!requestPayment.safeParse({ expected: 12.345 }).success);
  assert.ok(!reviewPayment.safeParse({ action: "approve", amount: 10, currency: "JOD", transfer: "TXN", independent: "" }).success);
});

test("signup is blocked unless both a loopback origin and the local switch are configured", () => {
  assert.equal(registrationAvailable("https://shop.example", "true"), false);
  assert.equal(registrationAvailable("http://localhost:3000", undefined), false);
  assert.equal(registrationAvailable("not a URL", "true"), false);
  assert.equal(registrationAvailable("http://localhost:3000", "true"), true);
});

test("normalizes image and valid PDF receipts and rejects mislabeled or oversized input", async () => {
  process.env.APP_ORIGIN = "http://localhost:3000";
  process.env.DAR_LOCAL_PDF = "true";
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#ccf" } }).png().toBuffer();
  const proof = await readPaymentProof(upload(png, "image/png"));
  assert.equal((await sharp(proof.content).metadata()).format, "webp");
  assert.equal((await readPaymentProof(upload(png, "image/png"))).hash, proof.hash);
  const pdf = await readPaymentProof(upload(receiptPdf(), "application/pdf"));
  const parsed = await sharp(pdf.content).metadata();
  assert.equal(parsed.format, "webp");
  assert.equal(parsed.width, 900);
  const pixels = await sharp(pdf.content).greyscale().stats();
  assert.ok(pixels.channels[0].min < 200);
  assert.notEqual(pdf.hash, proof.hash);
  await assert.rejects(readPaymentProof(upload(png, "application/pdf")), { status: 415 });
  await assert.rejects(readPaymentProof(upload(Buffer.from("%PDF-1.7\nmalformed\n%%EOF\n"), "application/pdf")), { status: 415 });
  await assert.rejects(readPaymentProof(upload(Buffer.alloc(5 * 1024 * 1024 + 1), "image/png")), { status: 413 });
});
