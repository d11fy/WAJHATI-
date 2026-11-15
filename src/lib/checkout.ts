import { z } from "zod";
import { storeSlug } from "./validation";
import { formatPrice, localizedValue, type Currency, type OptionGroup } from "./catalog";
import type { Locale } from "./i18n";

export const channels = ["whatsapp", "instagram"] as const;
export const statuses = ["initiated", "contact_opened", "merchant_confirmed", "cancelled"] as const;
export const maxLines = 12;
export const maxQuantity = 20;
export const channelInput = z.enum(channels);
export type Channel = z.infer<typeof channelInput>;
export const phoneSyntax = /^\+[1-9][0-9]{6,14}$/;
export const instagramSyntax = /^(?!\.)(?!.*\.\.)[a-z0-9._]{1,30}(?<!\.)$/;
const note = (maximum: number) => z.string().trim().max(maximum).regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f\p{Cs}]*$/u);

export const contactInput = z.strictObject({
  enabled: z.boolean(), whatsapp: z.boolean(), instagram: z.boolean(), defaultChannel: channelInput.nullable(), showContact: z.boolean(),
  phone: z.string().trim().refine((value) => !value || phoneSyntax.test(value)),
  handle: z.string().trim().toLowerCase().refine((value) => !value || instagramSyntax.test(value)),
  greetingAr: note(240), greetingEn: note(240), instructionsAr: note(400), instructionsEn: note(400),
}).refine((value) => (!value.whatsapp || value.phone) && (!value.instagram || value.handle)
  && (value.defaultChannel ? value[value.defaultChannel] : !value.enabled));

export type Contact = z.infer<typeof contactInput>;
export const emptyContact: Contact = {
  enabled: false, whatsapp: false, instagram: false, defaultChannel: null, showContact: false,
  phone: "", handle: "", greetingAr: "", greetingEn: "", instructionsAr: "", instructionsEn: "",
};

export const selectionInput = z.strictObject({ group: z.string().min(1).max(40), value: z.string().min(1).max(60) });
export const cartLineInput = z.strictObject({
  product: storeSlug, quantity: z.number().int().min(1).max(maxQuantity), options: z.array(selectionInput).max(8),
});
export type CartLine = z.infer<typeof cartLineInput>;
export const cartInput = z.array(cartLineInput).max(maxLines).refine((lines) => new Set(lines.map(lineKey)).size === lines.length);

export function lineKey(line: CartLine) {
  const choices = line.options.map(({ group, value }) => JSON.stringify([group, value])).sort();
  return JSON.stringify([line.product, choices]);
}

export function mergeCart(lines: CartLine[], line: CartLine) {
  const key = lineKey(line);
  const same = lines.find((item) => lineKey(item) === key);
  if (same) {
    const quantity = same.quantity + line.quantity;
    return quantity > maxQuantity ? null : changeQuantity(lines, key, quantity);
  }
  return lines.length >= maxLines ? null : [...lines, line];
}

export function changeQuantity(lines: CartLine[], key: string, quantity: number) {
  if (quantity === 0) return lines.filter((item) => lineKey(item) !== key);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) return lines;
  return lines.map((item) => lineKey(item) === key ? { ...item, quantity } : item);
}

export function canonicalOptions(options: CartLine["options"], groups: OptionGroup[]) {
  if (options.length !== groups.length) return null;
  const canonical = groups.map((group) => options.find((option) => option.group === group.name && group.values.includes(option.value)));
  return canonical.every((option) => option !== undefined) ? canonical : null;
}

export type PricedLine = CartLine & { nameAr: string; nameEn: string | null; unitMinor: number; imageId: string | null };
export type QuoteLine = { key: string; input: CartLine; line: PricedLine | null; issue?: "unavailableProduct" | "changedOptions" };
export type Quote = {
  name: string; currency: Currency; rows: QuoteLine[]; total: number; version: string;
  channels: Channel[]; defaultChannel: Channel | null; instructions: string; greeting: string;
};

export function lineTotal(line: Pick<PricedLine, "unitMinor" | "quantity">) { return line.unitMinor * line.quantity; }
export function orderTotal(lines: PricedLine[]) { return lines.reduce((total, line) => total + lineTotal(line), 0); }

export function contactLinks(contact: Contact) {
  return {
    whatsapp: contact.whatsapp && phoneSyntax.test(contact.phone) ? `https://wa.me/${contact.phone.slice(1)}` : null,
    instagram: contact.instagram && instagramSyntax.test(contact.handle) ? `https://www.instagram.com/${contact.handle}/` : null,
  };
}

export function orderMessage(input: { name: string; currency: Currency; lines: PricedLine[]; total: number; reference?: string; greeting: string; locale: Locale }) {
  const { name, currency, lines, total, reference, greeting, locale } = input;
  const ar = locale === "ar";
  const money = (value: number) => formatPrice(value, currency, locale);
  return [greeting, `${ar ? "المتجر" : "Store"}: ${name}`, reference ? `${ar ? "المرجع" : "Reference"}: ${reference}` : "", ...lines.map((line) => {
    const options = line.options.map(({ group, value }) => `${group}: ${value}`).join(" · ");
    return `${localizedValue(locale, line.nameAr, line.nameEn)}${options ? ` (${options})` : ""} × ${line.quantity} — ${money(line.unitMinor)} / ${ar ? "وحدة" : "unit"} = ${money(lineTotal(line))}`;
  }), `${ar ? "المجموع" : "Total"}: ${money(total)}`, ar ? "يخضع الطلب والأسعار لتأكيد البائع." : "Order and prices are subject to merchant confirmation."].filter(Boolean).join("\n");
}

export function whatsappTarget(phone: string, message: string, reference: string, locale: Locale) {
  if (!phoneSyntax.test(phone)) return null;
  const base = `https://wa.me/${phone.slice(1)}`;
  const full = `${base}?text=${encodeURIComponent(message.toWellFormed())}`;
  const short = full.length > 1800;
  const fallback = `${locale === "ar" ? "مرجع الطلب المبدئي" : "Order reference"}: ${reference}`;
  return { url: short ? `${base}?text=${encodeURIComponent(fallback)}` : full, short };
}
