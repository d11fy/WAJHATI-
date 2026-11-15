import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { markLegacy } from "../../tests/fixtures/legacy.mjs";

const origin = new URL(process.env.TEST_BASE_URL);
const database = new URL(process.env.TEST_MIGRATION_DATABASE_URL);
const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (origin.protocol !== "http:" || !loopback.has(origin.hostname) || origin.href !== `${origin.origin}/`
  || !loopback.has(database.hostname) || !/^\/dar_local_verify(?:_[a-z]+)?$/.test(database.pathname)) {
  throw new Error("Load tests require the isolated local verification environment");
}

const pool = new Pool({ connectionString: database.href });
const suffix = randomBytes(6).toString("hex");
const fixtures = [1015, 2040].map((price, index) => ({ price, slug: `load-${suffix}-${index}`, name: `Fixture ${suffix} ${index}` }));
const durations = [];
let errors = 0;

try {
  for (const { slug, name, price } of fixtures) {
    const { rows: [{ id }] } = await pool.query("insert into stores(name,slug,country,currency) values($1,$2,'KW','KWD') returning id", [name, slug]);
    await markLegacy(pool, slug);
    await pool.query("insert into catalog_products(store_id,slug,name_ar,name_en,price_minor,state) values($1,'sample',$2,$2,$3,'published')", [id, name, price]);
    await pool.query("update stores set published_at=now() where id=$1", [id]);
  }

  await Promise.all(Array.from({ length: 8 }, (_, worker) => (async () => {
    for (let step = 0; step < 12; step++) {
      const index = (worker + step) % fixtures.length;
      const { slug, name, price } = fixtures[index];
      const operation = (worker + step) % 3;
      const path = [`/ar/s/${slug}`, `/en/s/${slug}/p/sample`, `/api/checkout/${slug}`][operation];
      const options = operation === 2 ? {
        method: "POST", headers: { origin: origin.origin, "content-type": "application/json" },
        body: JSON.stringify({ action: "review", locale: "en", items: [{ product: "sample", quantity: 2, options: [] }] }),
      } : {};
      const started = performance.now();
      try {
        const response = await fetch(new URL(path, origin), { ...options, redirect: "error", signal: AbortSignal.timeout(15_000) });
        assert.equal(response.status, 200);
        if (operation === 2) {
          assert.equal(response.headers.get("cache-control"), "no-store");
          const quote = await response.json();
          assert.equal(quote.currency, "KWD");
          assert.equal(quote.total, price * 2);
          assert.equal(quote.rows[0].line.nameEn, name);
        } else {
          const html = await response.text();
          assert.ok(html.includes(name) && !html.includes(fixtures[1 - index].name));
          assert.ok(html.includes(operation === 0 ? 'dir="rtl"' : 'dir="ltr"'));
        }
      } catch (error) {
        if (++errors === 1) console.error(`Load operation ${operation} failed: ${error.message}`);
      } finally { durations.push(performance.now() - started); }
    }
  })()));

  durations.sort((a, b) => a - b);
  const percentile = (p) => Math.round(durations[Math.ceil(durations.length * p) - 1]);
  console.log(JSON.stringify({ event: "local_load", tenants: fixtures.length, concurrency: 8, requests: durations.length,
    errors, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) }));
  assert.equal(errors, 0);
} finally {
  try {
    const slugs = fixtures.map(({ slug }) => slug);
    await pool.query("delete from billing_subscriptions where store_id in (select id from stores where slug=any($1))", [slugs]);
    await pool.query("delete from stores where slug=any($1)", [slugs]);
  } finally { await pool.end(); }
}
