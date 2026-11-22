"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isLocale } from "@/lib/i18n";
import { aiOperations } from "@/lib/ai/fields";
import { storeSlug } from "@/lib/validation";
import { readSessionToken } from "@/server/auth/session";
import { aiAdminAdjust, aiAdminConfigure, type AiAdminResult } from "./admin";

export type AiAdminState = AiAdminResult | null;
const text = (form: FormData, name: string) => { const field = form.get(name); return typeof field === "string" ? field : ""; };
const on = (form: FormData, name: string) => form.get(name) === "on";
const slug = storeSlug;
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const schemas = {
  settings: z.object({
    enabled: z.boolean(), perMinute: int(1, 600), perDay: int(1, 100_000), trialCredits: int(0, 100_000), monthlyCredits: int(0, 1_000_000),
    usdInput: z.coerce.number().min(0).max(1000), usdOutput: z.coerce.number().min(0).max(1000),
  }),
  cost: z.object({ operation: z.enum(aiOperations), credits: int(0, 1000), active: z.boolean() }),
  store_suspend: z.object({ slug, suspended: z.boolean(), reason: z.string().trim().max(300) }),
} as const;

export async function aiConfigAction(locale: string, action: string, _previous: AiAdminState, form: FormData): Promise<AiAdminState> {
  if (!isLocale(locale)) notFound();
  if (!Object.hasOwn(schemas, action) || !on(form, "confirm")) return "invalid";
  const values = { ...Object.fromEntries(form), enabled: on(form, "enabled"), active: on(form, "active"), suspended: text(form, "suspended") === "true" };
  const parsed = schemas[action as keyof typeof schemas].safeParse(values);
  if (!parsed.success) return "invalid";
  try {
    const result = await aiAdminConfigure(await readSessionToken(), action as keyof typeof schemas, parsed.data);
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}

export async function aiAdjustAction(locale: string, _previous: AiAdminState, form: FormData): Promise<AiAdminState> {
  if (!isLocale(locale)) notFound();
  const parsed = z.object({ slug, amount: int(1, 100_000), direction: z.enum(["grant", "withdraw"]), note: z.string().trim().min(3).max(300) }).safeParse(Object.fromEntries(form));
  if (!parsed.success || !on(form, "confirm")) return "invalid";
  try {
    const result = await aiAdminAdjust(await readSessionToken(), parsed.data.slug, parsed.data.direction === "grant" ? parsed.data.amount : -parsed.data.amount, parsed.data.note);
    if (result === "ok") revalidatePath(`/${locale}/platform`, "layout");
    return result;
  } catch { return "unavailable"; }
}
