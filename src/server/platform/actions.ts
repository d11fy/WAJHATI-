"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { parseMinor } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n";
import { base32 } from "@/lib/platform";
import { normalizeWhatsappPhone, smtpInput, subscriptionMonths } from "@/lib/platform-contact";
import { countries, currencies } from "@/lib/validation";
import { sendTestSmtpMail } from "@/server/auth/mail";
import { consumeLimit, passwordCredential } from "@/server/auth/repository";
import { readSessionToken, readUser, setSessionCookie } from "@/server/auth/session";
import { sealSmtpPassword, smtpKeyReady } from "@/server/auth/smtp";
import { confirmManualSubscription, grantManualSubscription, saveContact, saveMail } from "./contact";
import { changeRole, configurePlatform, mfaSeed, mfaVerify, platformAccess, supportOperation, type PlatformResult } from "./repository";

export type MfaState = { error?: "invalid" | "unavailable"; seed?: string; recovery?: string[]; ok?: true } | null;
export type AdminState = PlatformResult | null;
const input = (form: FormData, name: string) => {
  const field = form.get(name);
  return typeof field === "string" ? field : "";
};
const enabled = (form: FormData, name: string) => form.get(name) === "on";

export async function mfaAction(locale: string, previous: MfaState, form: FormData): Promise<MfaState> {
  if (!isLocale(locale)) notFound();
  const token = await readSessionToken();
  const mode = input(form, "mode");
  const code = input(form, "code").trim();
  const current = await readUser();
  try {
    if (!current || !await platformAccess(token) || !await consumeLimit(`platform:mfa:${current.id}`, 12)) return { error: "invalid" };
    if (mode === "verify") {
      if (!/^\d{6}$/.test(code)) return { error: "invalid", seed: previous?.seed };
      const result = await mfaVerify(token, code);
      if (result) await setSessionCookie(result.token, new Date(result.expiresAt));
      return result ? { ok: true, recovery: result.recovery ?? undefined } : { error: "invalid", seed: previous?.seed };
    }
    if (mode !== "enroll" && mode !== "recover") return { error: "invalid" };
    const password = z.string().min(12).max(128).safeParse(form.get("password"));
    if (!password.success || !await passwordCredential(current.email, password.data)) return { error: "invalid" };
    if (!(mode === "recover" ? /^[a-f0-9]{32}$/.test(code) : /^[A-Za-z0-9_-]{43}$/.test(code))) return { error: "invalid" };
    const seed = await mfaSeed(token, code, mode === "recover");
    return seed ? { seed: base32(Buffer.from(seed, "hex")) } : { error: "invalid" };
  } catch { return { error: "unavailable", seed: previous?.seed }; }
}

export async function supportAction(locale: string, store: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  const action = z.enum(["suspend", "restore", "hold", "release", "end_legacy"]).safeParse(form.get("operation"));
  const reason = z.enum(["security", "abuse", "support", "billing"]).safeParse(form.get("reason"));
  if (!z.uuid().safeParse(store).success || !action.success || !reason.success || !enabled(form, "confirm")) return "invalid";
  try {
    const result = await supportOperation(await readSessionToken(), store, action.data, reason.data);
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}

export async function roleAction(locale: string, user: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  const role = z.enum(["owner", "administrator", "reviewer"]).safeParse(form.get("role"));
  const operation = z.enum(["grant", "revoke"]).safeParse(form.get("operation"));
  if (!z.uuid().safeParse(user).success || !role.success || !operation.success || !enabled(form, "confirm")) return "invalid";
  try {
    const result = await changeRole(await readSessionToken(), user, role.data, operation.data === "grant");
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}

const amount = z.coerce.number().int().min(1).max(1_000_000_000);
const label = z.string().trim().min(1).max(100);
const market = { country: z.enum(countries), currency: z.enum(currencies) };
const dual = z.partialRecord(z.enum(currencies), z.number().int().min(1).max(2_000_000_000));
const rules = z.object({ graceDays: z.coerce.number().int().min(0).max(30), trialDays: z.coerce.number().int().min(1).max(30),
  trialProducts: z.coerce.number().int().min(1).max(30), allowTrials: z.boolean(), luxury: z.boolean(), adminMaySuspend: z.boolean(), dual });
const schemas = {
  rules,
  plan: z.object({ code: z.enum(["starter","pro"]), version: z.coerce.number().int().positive().max(10000), name: label,
    products: z.coerce.number().int().min(1).max(10_000), storage: z.coerce.number().int().min(6).max(1_000_000),
    analytics: z.enum(["basic","enhanced"]), luxury: z.boolean(), premium: z.boolean() }),
  price: z.object({ ...market, plan: z.uuid(), interval: z.enum(["monthly","yearly"]), amount }),
  method: z.object({ ...market, label, instructions: z.string().trim().min(1).max(1600) }),
  setup: z.object({ ...market, label, amount }),
  price_active: z.object({ id: z.uuid(), active: z.boolean() }),
  method_active: z.object({ id: z.uuid(), active: z.boolean() }),
  setup_active: z.object({ id: z.uuid(), active: z.boolean() }),
} as const;

export async function configAction(locale: string, action: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  if (!Object.hasOwn(schemas, action) || !enabled(form,"confirm")) return "invalid";
  try {
    const values = Object.fromEntries(form);
    const data = schemas[action as keyof typeof schemas].safeParse({
      ...values, allowTrials: enabled(form,"allowTrials"), luxury: enabled(form,"luxury"), adminMaySuspend: enabled(form,"adminMaySuspend"),
      premium: enabled(form,"premium"), active: input(form,"active") === "true",
      dual: action === "rules" ? JSON.parse(input(form,"dual") || "{}") : {},
    });
    if (!data.success) return "invalid";
    const result = await configurePlatform(await readSessionToken(), action, data.data);
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch (error) { return error instanceof SyntaxError ? "invalid" : "unavailable"; }
}

export async function contactAction(locale: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  if (!enabled(form, "confirm")) return "invalid";
  const phone = normalizeWhatsappPhone(input(form, "whatsapp"));
  const contactEnabled = form.has("contactEnabled") ? enabled(form, "contactEnabled") : enabled(form, "enabled");
  if (!phone) return "invalid";
  try {
    const current = await readUser();
    if (!current || !await consumeLimit(`platform:contact:${current.id}`, 12)) return "unavailable";
    const result = await saveContact(await readSessionToken(), phone, contactEnabled);
    if (result === "ok") {
      revalidatePath(`/${locale}/platform`, "layout");
      revalidatePath(`/${locale}/pricing`);
      revalidatePath(`/${locale}`);
    }
    return result;
  } catch { return "unavailable"; }
}

export async function smtpSaveAction(locale: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  if (!enabled(form, "confirm")) return "invalid";
  if (!smtpKeyReady()) return "unavailable";
  const parsed = smtpInput.safeParse({
    host: input(form, "host"),
    port: input(form, "port"),
    user: input(form, "user"),
    from: input(form, "fromEmail"),
    name: input(form, "fromName"),
    replyTo: input(form, "replyTo").trim(),
  });
  const password = input(form, "password");
  if (!parsed.success || (password !== "" && (password.length > 512 || /[\r\n]/.test(password)))) return "invalid";
  try {
    const current = await readUser();
    if (!current || !await consumeLimit(`platform:smtp:${current.id}`, 12)) return "unavailable";
    const cipher = password ? sealSmtpPassword(password) : null;
    const result = await saveMail(await readSessionToken(), parsed.data, cipher, enabled(form, "enabled"));
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}

export async function smtpTestAction(locale: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  if (!enabled(form, "confirm")) return "invalid";
  try {
    const current = await readUser();
    if (!current || !await consumeLimit(`platform:smtp-test:${current.id}`, 6)) return "unavailable";
    const result = await sendTestSmtpMail(await readSessionToken(), locale, current.email);
    revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}

const manualSubscriptionSchema = z.object({
  id: z.uuid(),
  user: z.uuid(),
  store: z.uuid(),
  plan: z.enum(["starter", "pro"]),
  months: z.coerce.number().pipe(z.union([z.literal(subscriptionMonths[0]), z.literal(subscriptionMonths[1]), z.literal(subscriptionMonths[2]), z.literal(subscriptionMonths[3])])),
  currency: z.enum(currencies),
  reference: z.string().trim().min(3).max(120).regex(/^[^\r\n]+$/),
  note: z.string().trim().max(500).default(""),
});

export async function manualSubscriptionAction(locale: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  if (!enabled(form, "confirm")) return "invalid";
  const parsed = manualSubscriptionSchema.safeParse({
    id: input(form, "id") || randomUUID(),
    user: input(form, "user"),
    store: input(form, "store"),
    plan: input(form, "plan") || "pro",
    months: input(form, "months"),
    currency: input(form, "currency") || "ILS",
    reference: input(form, "reference"),
    note: input(form, "note"),
  });
  if (!parsed.success) return "invalid";
  const rawAmount = input(form, "amount").trim();
  const amountMinor = parseMinor(rawAmount, parsed.data.currency) ?? (/^\d+$/.test(rawAmount) ? Number(rawAmount) : null);
  if (!amountMinor || amountMinor < 1 || amountMinor > 1_000_000_000) return "invalid";
  try {
    const current = await readUser();
    if (!current || !await consumeLimit(`platform:manual-sub:${current.id}`, 24)) return "unavailable";
    const result = await grantManualSubscription(await readSessionToken(), {
      ...parsed.data,
      amountMinor,
    });
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}

export async function confirmManualSubscriptionAction(locale: string, id: string, _previous: AdminState, form: FormData): Promise<AdminState> {
  if (!isLocale(locale)) notFound();
  if (!z.uuid().safeParse(id).success || !enabled(form, "confirm")) return "invalid";
  try {
    const current = await readUser();
    if (!current || !await consumeLimit(`platform:manual-confirm:${current.id}`, 24)) return "unavailable";
    const result = await confirmManualSubscription(await readSessionToken(), id);
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}
