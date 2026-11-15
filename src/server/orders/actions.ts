"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { isLocale, locales } from "@/lib/i18n";
import { requireUser } from "@/server/auth/session";
import { changeOrder, saveOrderSettings, validateContact } from "./merchant";

export async function submitContact(locale: string, slug: string, _previous: string | null, form: FormData) {
  if (!isLocale(locale)) notFound();
  const user = await requireUser(locale);
  const value = form.get("config");
  if (typeof value !== "string" || value.length > 4000) return "invalid";
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { return "invalid"; }
  const contact = validateContact(decoded);
  if (!contact) return "invalid";
  const saved = await saveOrderSettings(user.id, slug, contact).catch(() => false);
  if (saved === null) notFound();
  if (!saved) return "failed";
  for (const language of locales) revalidatePath(`/${language}/s/${slug}`, "layout");
  redirect(`/${locale}/dashboard/stores/${slug}/contact?saved=1`);
}

export async function submitOrderChange(locale: string, slug: string, reference: string, action: "confirm" | "cancel" | "archive", _previous: string | null, form: FormData) {
  if (!isLocale(locale) || !/^DM-[A-F0-9]{20}$/.test(reference) || !["confirm", "cancel", "archive"].includes(action)) notFound();
  const user = await requireUser(locale);
  if (form.get("acknowledge") !== "on") return "acknowledge";
  const updated = await changeOrder(user.id, slug, reference, action).catch(() => false);
  if (!updated) return "conflict";
  const path = `/${locale}/dashboard/stores/${slug}/orders`;
  revalidatePath(path);
  revalidatePath(`${path}/${reference}`);
  redirect(action === "archive" ? `${path}?state=archived` : `${path}/${reference}?changed=1`);
}
