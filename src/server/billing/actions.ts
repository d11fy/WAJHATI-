"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { paymentMethods, requestPayment, reviewPayment, type BillingError } from "@/lib/billing";
import { parseMinor } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n";
import { consumeLimit } from "@/server/auth/repository";
import { readSessionToken, requireUser } from "@/server/auth/session";
import { reportOperationalError } from "@/server/ops/report";
import { contactSettings } from "@/server/platform/contact";
import { cancelAtEnd, createPaymentRequest, reviewRequest, trialForStore } from "./repository";

export type BillingActionState = { ok: true; id?: string; pendingReview?: boolean } | { error: BillingError } | null;
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
};

export async function requestPaymentAction(locale: string, slug: string, _state: BillingActionState, form: FormData): Promise<BillingActionState> {
  if (!isLocale(locale)) notFound();
  const user = await requireUser(locale);
  const input = requestPayment.safeParse({
    key: text(form, "key"), price: text(form, "price"), method: text(form, "method"), setup: text(form, "setup") || null,
    expected: Number(text(form, "expected")), notes: text(form, "notes"),
  });
  if (!input.success) return { error: "invalid" };
  try {
    if ((await contactSettings())?.enabled) return { error: "unavailable" };
    if (!await consumeLimit(`billing:request:${user.id}`, 20)) return { error: "unavailable" };
    const result = await createPaymentRequest(user.id, slug, input.data);
    if (!result) return { error: "denied" };
    if ("error" in result) return { error: result.error };
    revalidatePath(`/${locale}/dashboard/stores/${slug}/billing`);
    return { ok: true, id: result.id };
  } catch { return { error: "unavailable" }; }
}

export async function subscriptionAction(locale: string, slug: string, operation: "trial" | "cancel" | "keep", _state: BillingActionState, form: FormData): Promise<BillingActionState> {
  if (!isLocale(locale)) notFound();
  const user = await requireUser(locale);
  if (operation === "cancel" && form.get("confirm") !== "on") return { error: "invalid" };
  try {
    if (!await consumeLimit(`billing:subscription:${user.id}`, 20)) return { error: "unavailable" };
    const result = operation === "trial" ? await trialForStore(user.id, slug) : await cancelAtEnd(user.id, slug, operation === "cancel");
    if (result !== "ok") return { error: result ?? "denied" };
    revalidatePath(`/${locale}/dashboard/stores/${slug}/billing`);
    return { ok: true };
  } catch { return { error: "unavailable" }; }
}

export async function reviewPaymentAction(locale: string, id: string, _state: BillingActionState, form: FormData): Promise<BillingActionState> {
  if (!isLocale(locale)) notFound();
  const action = text(form, "operation");
  const currency = paymentMethods.safeParse(text(form, "currency").trim().toUpperCase());
  if ((action === "approve" || action === "complete_setup") && form.get("verified") !== "on") return { error: "invalid" };
  const review = reviewPayment.safeParse({
    action, amount: currency.success ? parseMinor(text(form, "amount"), currency.data) : null, currency: currency.data,
    transfer: text(form, "transfer"), independent: text(form, "independent"), reason: text(form, "reason"),
  });
  if (!review.success) return { error: "invalid" };
  try {
    const result = await reviewRequest(await readSessionToken(), id, review.data);
    if (result !== "ok" && result !== "secondReview") return { error: result };
    revalidatePath(`/${locale}/payment-review`);
    revalidatePath(`/${locale}/payment-review/${id}`);
    return { ok: true, pendingReview: result === "secondReview" };
  } catch {
    void reportOperationalError("payment_review_failed", "review");
    return { error: "unavailable" };
  }
}
