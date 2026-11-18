import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gapsUsed, legalApproved, legalDocs, legalKinds, ownerGaps, parts, supportEmail, unresolvedGapCount, type Block, type LegalDoc } from "../../src/lib/legal";
import { marketingMetadata, sitemapEntries } from "../../src/lib/seo";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const everyDoc = () => legalKinds.flatMap((kind) => (["ar", "en"] as const).map((locale) => ({ kind, locale, doc: legalDocs[kind][locale] })));
function text(doc: LegalDoc) {
  const blocks = (list: Block[]) => list.flatMap((block) => "p" in block ? [block.p] : "ul" in block ? block.ul : [...block.table.head, ...block.table.rows.flat()]);
  return [doc.title, doc.summary, ...doc.sections.flatMap((section) => [section.heading, ...blocks(section.blocks)])].join("\n");
}

test("Arabic and English documents have the same structure and the same open items", () => {
  for (const kind of legalKinds) {
    const [ar, en] = [legalDocs[kind].ar, legalDocs[kind].en];
    assert.deepEqual(ar.sections.map((section) => section.id), en.sections.map((section) => section.id), `${kind} section ids`);
    ar.sections.forEach((section, index) => assert.equal(section.blocks.length, en.sections[index].blocks.length, `${kind}/${section.id} block count`));
    assert.deepEqual([...gapsUsed(ar)].sort(), [...gapsUsed(en)].sort(), `${kind} owner-review items`);
    assert.equal(new Set(ar.sections.map((section) => section.id)).size, ar.sections.length, "section ids are unique anchors");
  }
});

test("every token resolves, every owner gap is documented, and nothing reads as approved", () => {
  const review = read("docs/legal/LEGAL_OWNER_REVIEW.md");
  for (const { kind, locale, doc } of everyDoc()) {
    for (const section of doc.sections) {
      const sources = section.blocks.flatMap((block) => "p" in block ? [block.p] : "ul" in block ? block.ul : [...block.table.head, ...block.table.rows.flat()]);
      for (const source of sources) assert.doesNotThrow(() => parts(source, locale, { EMAIL: supportEmail, WHATSAPP: "+1" }), `${kind}/${locale}/${section.id}`);
    }
    assert.doesNotMatch(text(doc), /\b(TODO|FIXME|lorem)\b/i);
    assert.doesNotMatch(text(doc), /\b(GDPR|ISO ?27001|SOC ?2|PCI|certified|legally approved)\b/i, "no unsupported compliance claims");
  }
  for (const id of Object.keys(ownerGaps)) assert.ok(review.includes(`\`${id}\``), `LEGAL_OWNER_REVIEW.md must document ${id}`);
  const used = new Set(everyDoc().flatMap(({ doc }) => gapsUsed(doc)));
  for (const id of Object.keys(ownerGaps)) assert.ok(used.has(id as keyof typeof ownerGaps), `${id} is declared but never used`);
});

test("business rules in the Terms match the platform: plans, trial, manual activation, no payment gateway", () => {
  const en = text(legalDocs.terms.en);
  const ar = text(legalDocs.terms.ar);
  for (const phrase of ["Starter", "Pro", "Monthly", "Yearly", "72-hour", "1, 3, 6 or 12 months", "one store", "no automatic renewal", "no payment gateway", "not proof of payment"]) assert.ok(en.includes(phrase), `English terms mention ${phrase}`);
  for (const phrase of ["Starter", "Pro", "شهري", "سنوي", "72 ساعة", "1 أو 3 أو 6 أو 12", "متجرًا واحدًا", "لا يوجد تجديد تلقائي", "ليس دليل دفع"]) assert.ok(ar.includes(phrase), `Arabic terms mention ${phrase}`);
  assert.doesNotMatch(en, /money-back|guarantee[d]? refund|no refunds?/i, "no invented refund rule");
});

test("retention figures in the Privacy Policy agree with the retention SQL", () => {
  const sql = read("drizzle/0008_order_access.sql");
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /interval '365 days'/);
  const en = text(legalDocs.privacy.en);
  assert.match(en, /Unconfirmed ones are deleted after 90 days and merchant-confirmed ones after 365 days/);
  assert.match(text(legalDocs.privacy.ar), /90 يومًا.*365 يومًا/s);
  assert.match(read("drizzle/0019_operations_access.sql"), /interval '90 days'/);
});

test("the policy does not claim data the order record does not hold, and states the manual deletion reality", () => {
  const schema = read("src/server/db/order-schema.ts");
  for (const forbidden of ["customerName", "customer_name", "phone", "address", "email"]) assert.ok(!new RegExp(forbidden, "i").test(schema.slice(schema.indexOf("export const orderIntents"))), `order schema has no ${forbidden}`);
  assert.match(text(legalDocs.privacy.en), /does not currently offer self-service account deletion or data export/);
});

test("legal pages are indexable and in the sitemap only after explicit approval", () => {
  const production = { DAR_ENV: "production", APP_ORIGIN: "https://wajhati.store" };
  assert.equal(legalApproved({}), false);
  assert.equal(legalApproved({ LEGAL_APPROVED: "yes" }), false);
  // The flag alone is not approval: the text must also be finished. Today all 20 owner-review items are open.
  assert.equal(unresolvedGapCount(), Object.keys(ownerGaps).length);
  assert.equal(legalApproved({ LEGAL_APPROVED: "true" }), false);
  assert.equal(legalApproved({ LEGAL_APPROVED: "true" }, 3), false);
  assert.equal(legalApproved({}, 0), false);
  assert.equal(legalApproved({ LEGAL_APPROVED: "true" }, 0), true);
  const draft = sitemapEntries(production).map((entry) => entry.url);
  assert.ok(!draft.some((url) => /privacy|terms/.test(url)));
  assert.ok(!sitemapEntries({ ...production, LEGAL_APPROVED: "true" }).some((entry) => /privacy|terms/.test(entry.url)), "the flag alone never publishes the drafts");
  const approved = sitemapEntries({ ...production, LEGAL_APPROVED: "true" }, new Date(), 0).map((entry) => entry.url);
  for (const locale of ["ar", "en"]) for (const path of ["privacy", "terms"]) assert.ok(approved.includes(`https://wajhati.store/${locale}/${path}`));
  assert.deepEqual(marketingMetadata("en", "/terms", "Terms", "x", false).robots, { index: false, follow: true });
  assert.equal(marketingMetadata("en", "/terms", "Terms", "x", true).robots, undefined);
});

test("no deployable configuration in the repository approves the legal text", () => {
  // The approval flag must stay false until the owner and legal reviewer sign off. Nothing checked in may set it to true.
  for (const path of [".env.example", "compose.yaml", "Dockerfile", ".github/workflows/ci.yml", "infra/env/app.env.example", "infra/env/mailer.env.example",
    "infra/env/worker.env.example", "infra/env/backup.env.example", "infra/dokploy/compose.staging.yaml", "scripts/local-env.mjs", "scripts/ops/staging-env.mjs",
    "scripts/ops/dokploy-bootstrap.mjs"]) {
    assert.doesNotMatch(read(path), /LEGAL_APPROVED["']?\s*[:=]\s*["']?true/i, `${path} must not approve the legal text`);
  }
  assert.match(read("infra/env/app.env.example"), /^LEGAL_APPROVED=false$/m);
  assert.match(read("infra/dokploy/compose.staging.yaml"), /LEGAL_APPROVED: "false"/);
});
