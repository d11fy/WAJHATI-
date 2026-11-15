import { z } from "zod";
import { storeSlug, type currencies } from "./validation";

export type Currency = (typeof currencies)[number];
export type ProductState = "draft" | "published" | "archived";
export type MediaKind = "product" | "category";
export type OptionGroup = { name: string; values: string[] };

const minorDigits: Record<Currency, number> = {
  USD: 2, EUR: 2, ILS: 2, SAR: 2, AED: 2, EGP: 2, JOD: 3, KWD: 3, QAR: 2, BHD: 3, OMR: 3,
  LBP: 2, IQD: 3, SYP: 2, YER: 2, MAD: 2, DZD: 2, TND: 3, LYD: 3, SDG: 2, MRU: 2, SOS: 2, DJF: 0, KMF: 0,
};

export function asciiDigits(input: string) {
  return input.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) & 15));
}

export function parseMinor(input: string, currency: Currency) {
  const normalized = asciiDigits(input.trim()).replace("٫", ".");
  const match = /^(\d{1,10})(?:\.(\d{1,3}))?$/.exec(normalized);
  if (!match) return null;
  const digits = minorDigits[currency];
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return null;
  const minor = BigInt(match[1]) * (10n ** BigInt(digits)) + BigInt(fraction.padEnd(digits, "0") || "0");
  return minor > 2_147_483_647n ? null : Number(minor);
}

function splitMinor(minor: number, currency: Currency) {
  const digits = minorDigits[currency];
  const unit = 10n ** BigInt(digits);
  return { digits, whole: BigInt(minor) / unit, fraction: BigInt(minor) % unit };
}

export function priceInput(minor: number, currency: Currency) {
  const { digits, whole, fraction } = splitMinor(minor, currency);
  return digits ? `${whole}.${String(fraction).padStart(digits, "0")}` : String(whole);
}

export function formatPrice(minor: number, currency: Currency, locale: string) {
  const { digits, whole, fraction } = splitMinor(minor, currency);
  const format = new Intl.NumberFormat(locale, {
    style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  if (!digits) return format.format(whole);
  const localizedFraction = new Intl.NumberFormat(locale, { minimumIntegerDigits: digits, useGrouping: false }).format(fraction);
  return format.formatToParts(whole).map((part) => part.type === "fraction" ? localizedFraction : part.value).join("");
}

export function validatePrices(price: string, compareAt: string, currency: Currency) {
  const priceMinor = parseMinor(price, currency);
  const compareAtMinor = compareAt.trim() ? parseMinor(compareAt, currency) : null;
  if (priceMinor === null || (compareAt.trim() && (compareAtMinor === null || compareAtMinor <= priceMinor))) return null;
  return { priceMinor, compareAtMinor };
}

const safeText = (maximum: number) => z.string().trim().max(maximum).refine((text) => !/[\p{Cs}\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text));
const singleLine = (maximum: number) => safeText(maximum).refine((text) => !/[\r\n\t]/.test(text));
const optionalLine = (maximum: number) => singleLine(maximum).transform((text) => text || null);
const requiredName = singleLine(100).refine((text) => Array.from(text).length >= 2);
const slug = z.string().trim().toLowerCase().pipe(storeSlug);
const position = z.string().trim().transform(asciiDigits).pipe(z.string().regex(/^\d{1,6}$/)).transform(Number);
export const catalogId = z.uuid();

export const categoryInput = z.object({
  nameAr: requiredName, nameEn: optionalLine(100), slug, position, visible: z.boolean(),
});

export const productInput = z.object({
  nameAr: requiredName, nameEn: optionalLine(100), slug, position,
  descriptionAr: safeText(2_000).transform((text) => text || null),
  descriptionEn: safeText(2_000).transform((text) => text || null),
  price: z.string().max(20), compareAt: z.string().max(20), sku: optionalLine(64),
  state: z.enum(["draft", "published"]), featured: z.boolean(), available: z.boolean(),
  categoryIds: z.array(catalogId).max(12).transform((ids) => [...new Set(ids)]),
  options: safeText(2_000),
});

export function parseOptions(text: string): OptionGroup[] | null {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 8) return null;
  const groups: OptionGroup[] = [];
  for (const line of lines) {
    const [rawName, rawValues, extra] = line.split(":");
    const name = singleLine(40).safeParse(rawName);
    const values = rawValues?.split(/[,،]/).map((value) => singleLine(60).safeParse(value));
    if (extra !== undefined || !name.success || !name.data || !values || values.length > 10) return null;
    const parsed = values.flatMap((value) => value.success && value.data ? [value.data] : []);
    if (parsed.length !== values.length || new Set(parsed.map((value) => value.toLowerCase())).size !== parsed.length) return null;
    if (groups.some((group) => group.name.toLowerCase() === name.data.toLowerCase())) return null;
    groups.push({ name: name.data, values: parsed });
  }
  return groups;
}

export type CategoryInput = z.output<typeof categoryInput>;
export type ProductInput = z.output<typeof productInput>;

export const pageSize = 12;
export const maxPage = 1_000;
type SearchParams = Record<string, string | string[] | undefined>;
const productStates = z.enum(["draft", "published", "archived"]);
const sortTypes = z.enum(["featured", "price-asc", "price-desc", "newest"]);

export function catalogFilters(params: SearchParams, merchant = false) {
  const get = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const page = get("page");
  const pageNumber = page && /^\d{1,4}$/.test(page) ? Math.max(1, Math.min(maxPage, Number(page))) : 1;
  return {
    page: pageNumber,
    q: singleLine(80).safeParse(get("q")).data ?? "",
    category: (merchant ? catalogId : storeSlug).safeParse(get("category")).data ?? "",
    state: merchant ? productStates.safeParse(get("state")).data : undefined,
    sort: sortTypes.safeParse(get("sort")).data ?? "featured",
    availableOnly: get("available") === "1",
  };
}

export type CatalogFilters = ReturnType<typeof catalogFilters>;

export function searchPattern(q: string) {
  return q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
}

export function localizedValue(locale: "ar" | "en", arabic: string, english: string | null) {
  return locale === "en" && english ? english : arabic;
}
