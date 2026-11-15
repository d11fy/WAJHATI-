import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { catalogFilters, formatPrice, parseMinor, parseOptions, priceInput, searchPattern, validatePrices } from "../../src/lib/catalog";
import { maximumImageBytes, readCatalogImage } from "../../src/server/catalog/image-content";

test("minor units are exact for ISO 4217 currencies with zero, two, and three decimals", () => {
  for (const currency of ["JOD", "IQD", "KWD", "BHD", "OMR", "TND", "LYD"] as const) {
    assert.equal(parseMinor("١٢٫٣٤٥", currency), 12345);
    assert.equal(parseMinor("۱۲.۳۴۵", currency), 12345);
    assert.equal(priceInput(12345, currency), "12.345");
  }
  assert.equal(parseMinor("1.01", "SAR"), 101);
  assert.equal(parseMinor("1.001", "SAR"), null);
  assert.equal(parseMinor("12", "DJF"), 12);
  assert.equal(parseMinor("12.0", "KMF"), null);
  assert.equal(parseMinor("2147483.647", "JOD"), 2_147_483_647);
  assert.equal(parseMinor("2147483.648", "JOD"), null);
  assert.equal(parseMinor("1e3", "JOD"), null);
  assert.equal(parseMinor("-1.00", "SAR"), null);
  assert.match(formatPrice(12005, "JOD", "en"), /12\.005/);
  assert.match(formatPrice(12005, "JOD", "ar"), /005|٠٠٥/);
});

test("compare-at price must be higher and uses the same currency precision", () => {
  assert.deepEqual(validatePrices("5.001", "5.002", "BHD"), { priceMinor: 5001, compareAtMinor: 5002 });
  assert.deepEqual(validatePrices("0", "", "JOD"), { priceMinor: 0, compareAtMinor: null });
  assert.equal(validatePrices("5", "5.000", "JOD"), null);
  assert.equal(validatePrices("5", "4.999", "JOD"), null);
  assert.equal(validatePrices("5", "6.0001", "JOD"), null);
});

test("options and search are bounded and wildcard characters are literal", () => {
  assert.deepEqual(parseOptions("الحجم: صغير، كبير\nColor: Red, Blue"), [
    { name: "الحجم", values: ["صغير", "كبير"] }, { name: "Color", values: ["Red", "Blue"] },
  ]);
  assert.equal(parseOptions("Size: Small, small"), null);
  assert.equal(parseOptions("Size: Small\nsize: Large"), null);
  assert.equal(parseOptions("Size:"), null);
  assert.equal(searchPattern("a%_\\b"), "%a\\%\\_\\\\b%");
  assert.equal(catalogFilters({ page: "9999", state: "archived" }).page, 1000);
  assert.equal(catalogFilters({ state: "archived" }).state, undefined);
});

const request = (type: string, body: Uint8Array<ArrayBuffer>) => new Request("http://localhost/catalog", {
  method: "POST", headers: { "content-type": type }, body,
});

test("image decoder verifies content, drops input metadata, and outputs WebP", async () => {
  const png = await sharp({ create: { width: 24, height: 24, channels: 3, background: "red" } }).png().withMetadata().toBuffer();
  const webp = await readCatalogImage(request("image/png", new Uint8Array(png)));
  const metadata = await sharp(webp).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 24);
  assert.equal(metadata.exif, undefined);
  await assert.rejects(readCatalogImage(request("image/jpeg", new Uint8Array(png))), { status: 415 });
  await assert.rejects(readCatalogImage(request("image/png", new Uint8Array(png.subarray(0, 16)))), { status: 415 });
  await assert.rejects(readCatalogImage(request("image/svg+xml", new Uint8Array(png))), { status: 415 });
});

test("image byte cap applies to requests without Content-Length", async () => {
  await assert.rejects(readCatalogImage(request("image/png", new Uint8Array(maximumImageBytes + 1))), { status: 413 });
});
