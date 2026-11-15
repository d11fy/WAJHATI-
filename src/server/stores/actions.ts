"use server";

import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { storeInput } from "@/lib/validation";
import { requireUser } from "@/server/auth/session";
import { createStore } from "./repository";

export type StoreError = "invalid" | "linkTaken";

export async function submitStore(locale: string, _state: StoreError | null, form: FormData): Promise<StoreError> {
  if (!isLocale(locale)) notFound();
  const user = await requireUser(locale);
  const input = storeInput.safeParse({ name: form.get("name"), slug: form.get("slug"), country: form.get("country"), currency: form.get("currency") });
  if (!input.success) return "invalid";
  if (!await createStore(user.id, input.data)) return "linkTaken";
  redirect(`/${locale}/dashboard/stores/${input.data.slug}`);
}
