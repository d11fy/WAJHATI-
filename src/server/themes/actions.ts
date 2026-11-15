"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { isLocale, locales } from "@/lib/i18n";
import { themeConfig } from "@/lib/theme-config";
import { requireUser } from "@/server/auth/session";
import { publishDesign, restorePublishedDesign, saveDesign, type DesignError } from "./design";

async function actor(locale: string) {
  if (!isLocale(locale)) notFound();
  return requireUser(locale);
}

async function safeResult<T>(operation: Promise<T>): Promise<T | { error: "unavailable" }> {
  return operation.catch(() => {
    console.error("Store design operation failed.");
    return { error: "unavailable" };
  });
}

function designPath(locale: string, slug: string) {
  return `/${locale}/dashboard/stores/${slug}/design`;
}

export async function submitDesign(locale: string, slug: string, revision: number, _previous: DesignError | null, form: FormData): Promise<DesignError> {
  const user = await actor(locale);
  const value = form.get("config");
  if (typeof value !== "string" || value.length > 16_000 || !Number.isSafeInteger(revision) || revision < 0) return "invalid";
  let json: unknown;
  try { json = JSON.parse(value); } catch { return "invalid"; }
  const parsed = themeConfig.safeParse(json);
  if (!parsed.success) return parsed.error.issues.some((issue) => issue.message === "contrast") ? "contrast" : "invalid";
  const result = await safeResult(saveDesign(user.id, slug, revision, parsed.data));
  if (!result) notFound();
  if ("error" in result) return result.error;
  const path = designPath(locale, slug);
  revalidatePath(path);
  redirect(`${path}?status=saved`);
}

export async function confirmDesign(locale: string, slug: string, revision: number, operation: "publish" | "restore" | "restorePrevious"): Promise<DesignError> {
  const user = await actor(locale);
  if (!Number.isSafeInteger(revision) || revision < 1 || !["publish", "restore", "restorePrevious"].includes(operation)) return "invalid";
  const result = await safeResult(operation === "publish" ? publishDesign(user.id, slug, revision) : restorePublishedDesign(user.id, slug, revision, operation === "restorePrevious"));
  if (!result) notFound();
  if ("error" in result) return result.error;
  const path = designPath(locale, slug);
  revalidatePath(path);
  if (operation === "publish") {
    for (const language of locales) revalidatePath(`/${language}/s/${slug}`, "layout");
  }
  redirect(`${path}?status=${operation === "publish" ? "published" : operation === "restore" ? "restored" : "previousRestored"}`);
}
