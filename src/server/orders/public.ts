import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { canonicalOptions, channels, contactInput, contactLinks, emptyContact, lineKey, orderMessage, orderTotal, whatsappTarget, type CartLine, type Channel, type Contact, type PricedLine, type Quote, type statuses } from "@/lib/checkout";
import { localizedValue, type Currency, type OptionGroup } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import { digest } from "@/server/auth/crypto";
import type { Transaction } from "@/server/db/actor";
import { database } from "@/server/db/client";

type Product = Omit<PricedLine, "quantity" | "options"> & { groups: OptionGroup[] };
type Context = { storeId: string; name: string; currency: Currency; config: Contact; products: Product[] };
type Intent = { reference: string; fingerprint: string; status: typeof statuses[number]; archived: boolean; channel: Channel; currency: Currency; total: number; locale: Locale; lines: PricedLine[] };
type BeginResult = { reference: string; message: string; short: boolean }
  | { error: "stale"; quote: Quote }
  | { error: "notFound" | "disabled" | "conflict"; quote?: never };

async function context(slug: string, lines: CartLine[] = [], tx?: Transaction) {
  const products = sql.join([...new Set(lines.map((line) => line.product))].map((product) => sql`${product}`), sql`, `);
  const { rows: [row] } = await (tx ?? await database()).execute<{ context: Context | null }>(sql`
    select public.order_public_context(${slug}, ARRAY[${products}]::text[]) as context
  `);
  if (!row.context) return null;
  return { ...row.context, config: contactInput.safeParse(row.context.config).data ?? emptyContact };
}

export async function storefrontContact(slug: string) {
  const data = await context(slug);
  if (!data) return null;
  return { storeId: data.storeId, accepting: data.config.enabled, links: data.config.showContact ? contactLinks(data.config) : null };
}

function makeQuote(data: Context, items: CartLine[], locale: Locale): Quote {
  const rows: Quote["rows"] = items.map((input) => {
    const key = lineKey(input);
    const product = data.products.find((item) => item.product === input.product);
    if (!product) return { key, input, line: null, issue: "unavailableProduct" };
    const { groups, ...fields } = product;
    const options = canonicalOptions(input.options, groups);
    if (!options) return { key, input, line: null, issue: "changedOptions" };
    return { key, input, line: { ...fields, quantity: input.quantity, options } };
  });
  const lines = rows.flatMap(({ line }) => line ? [line] : []);
  const config = data.config;
  return {
    name: data.name, currency: data.currency, rows, total: orderTotal(lines),
    version: digest(JSON.stringify([data.currency, rows.map(({ key, input, line }) => [key, input.quantity, line?.unitMinor ?? null])])),
    channels: config.enabled ? channels.filter((channel) => config[channel]) : [], defaultChannel: config.enabled ? config.defaultChannel : null,
    instructions: config.enabled ? localizedValue(locale, config.instructionsAr || config.instructionsEn, config.instructionsEn) : "",
    greeting: config.enabled ? localizedValue(locale, config.greetingAr || config.greetingEn, config.greetingEn) : "",
  };
}

export async function reviewCart(slug: string, items: CartLine[], locale: Locale) {
  const data = await context(slug, items);
  return data ? makeQuote(data, items, locale) : null;
}

async function lockStore(tx: Transaction, slug: string) {
  const data = await context(slug, [], tx);
  if (!data) return false;
  // Catalog, publication and settings mutations share the same per-store lock.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${data.storeId}, 1))`);
  return true;
}

async function readIntent(tx: Transaction, slug: string, key: string) {
  const { rows: [row] } = await tx.execute<{ intent: Intent | null }>(sql`select public.order_visitor_intent(${slug}, ${key}) as intent`);
  return row.intent;
}

function summary(data: Context, intent: Pick<Intent, "reference" | "channel" | "locale" | "lines" | "currency" | "total">) {
  const greeting = intent.channel === "whatsapp" ? localizedValue(intent.locale, data.config.greetingAr || data.config.greetingEn, data.config.greetingEn) : "";
  const message = orderMessage({ ...intent, greeting, name: data.name });
  const target = intent.channel === "whatsapp"
    ? whatsappTarget(data.config.phone, message, intent.reference, intent.locale)
    : { url: contactLinks(data.config).instagram, short: false };
  return { reference: intent.reference, message, short: target?.short ?? false, url: target?.url ?? null };
}

export async function beginOrder(input: { slug: string; key: string; items: CartLine[]; locale: Locale; channel: Channel; version: string }): Promise<BeginResult> {
  const { slug, key, items, locale, channel, version } = input;
  return (await database()).transaction(async (tx) => {
    if (!await lockStore(tx, slug)) return { error: "notFound" } as const;
    const data = await context(slug, items, tx);
    if (!data) return { error: "notFound" } as const;
    if (!data.config.enabled || !data.config[channel]) return { error: "disabled" } as const;
    const fingerprint = digest(JSON.stringify([channel, locale, version, items.map((line) => [lineKey(line), line.quantity])]));
    const existing = await readIntent(tx, slug, key);
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.archived || !["initiated", "contact_opened"].includes(existing.status)) return { error: "conflict" } as const;
      const result = summary(data, existing);
      return { reference: result.reference, message: result.message, short: result.short };
    }
    const quote = makeQuote(data, items, locale);
    if (quote.version !== version || !quote.rows.length || quote.rows.some(({ line }) => !line)) return { error: "stale", quote } as const;
    const lines = quote.rows.flatMap(({ line }) => line ? [line] : []);
    const reference = `DM-${randomBytes(10).toString("hex").toUpperCase()}`;
    const { rows: [saved] } = await tx.execute<{ ok: boolean }>(sql`select public.order_create_intent(${slug}, ${key}, ${fingerprint}, ${reference},
      ${channel}::public.order_channel, ${locale}, ${quote.total}::bigint, ${JSON.stringify(lines)}::jsonb) as ok`);
    if (!saved.ok) return { error: "conflict" } as const;
    const result = summary(data, { reference, channel, locale, lines, currency: quote.currency, total: quote.total });
    return { reference, message: result.message, short: result.short };
  });
}

export async function openOrderContact(slug: string, key: string, reference: string) {
  return (await database()).transaction(async (tx) => {
    if (!await lockStore(tx, slug)) return null;
    const intent = await readIntent(tx, slug, key);
    if (!intent || intent.reference !== reference) return null;
    const items = intent.lines.map(({ product, quantity, options }) => ({ product, quantity, options }));
    const data = await context(slug, items, tx);
    if (!data || !data.config.enabled || !data.config[intent.channel]) return null;
    const current = makeQuote(data, items, intent.locale);
    if (current.currency !== intent.currency || current.rows.some(({ line }, index) => line?.unitMinor !== intent.lines[index].unitMinor)) return { stale: true } as const;
    const { url } = summary(data, intent);
    if (!url) return null;
    const { rows: [event] } = await tx.execute<{ ok: boolean }>(sql`select public.order_contact_open(${slug}, ${key}, ${reference}) as ok`);
    return event.ok ? { url } : null;
  });
}
