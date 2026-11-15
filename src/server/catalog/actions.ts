"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { categoryInput, productInput } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n";
import { requireUser } from "@/server/auth/session";
import { archiveProduct, deleteCategory, saveCategory, saveProduct, setStorePublication, type CatalogError } from "./merchant";

export type FormError = CatalogError | "invalid" | "unavailable";

async function actor(locale: string) {
  if (!isLocale(locale)) notFound();
  return requireUser(locale);
}

async function safeResult<T>(result: Promise<T>): Promise<T | { error: "unavailable" }> {
  return result.catch(() => {
    console.error("Catalog mutation failed.");
    return { error: "unavailable" };
  });
}

function identityFields(form: FormData) {
  return { nameAr: form.get("nameAr"), nameEn: form.get("nameEn") ?? "", slug: form.get("slug"), position: form.get("position") };
}

export async function submitCategory(locale: string, store: string, id: string | null, _previous: FormError | null, form: FormData): Promise<FormError> {
  const user = await actor(locale);
  const input = categoryInput.safeParse({ ...identityFields(form), visible: form.get("visible") === "on" });
  if (!input.success) return "invalid";
  const result = await safeResult(saveCategory(user.id, store, id, input.data));
  if (!result) notFound();
  if ("error" in result) return result.error;
  const path = `/${locale}/dashboard/stores/${store}/categories/${result.id}`;
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function submitProduct(locale: string, store: string, id: string | null, _previous: FormError | null, form: FormData): Promise<FormError> {
  const user = await actor(locale);
  const input = productInput.safeParse({
    ...identityFields(form), descriptionAr: form.get("descriptionAr") ?? "", descriptionEn: form.get("descriptionEn") ?? "",
    price: form.get("price"), compareAt: form.get("compareAt") ?? "", sku: form.get("sku") ?? "", state: form.get("state"),
    featured: form.get("featured") === "on", available: form.get("available") === "on",
    categoryIds: form.getAll("categoryIds"), options: form.get("options") ?? "",
  });
  if (!input.success) return "invalid";
  const result = await safeResult(saveProduct(user.id, store, id, input.data));
  if (!result) notFound();
  if ("error" in result) return result.error;
  const path = `/${locale}/dashboard/stores/${store}/products/${result.id}`;
  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

export async function confirmCatalogAction(locale: string, store: string, operation: "deleteCategory" | "archiveProduct" | "publishStore" | "unpublishStore", id: string | null): Promise<FormError> {
  const user = await actor(locale);
  const base = `/${locale}/dashboard/stores/${store}`;
  if (operation === "publishStore" || operation === "unpublishStore") {
    const result = await safeResult(setStorePublication(user.id, store, operation === "publishStore"));
    if (!result) notFound();
    if ("error" in result) return result.error;
    revalidatePath(base);
    redirect(base);
  }
  if (!id || (operation !== "deleteCategory" && operation !== "archiveProduct")) notFound();
  const result = await safeResult(operation === "deleteCategory" ? deleteCategory(user.id, store, id) : archiveProduct(user.id, store, id));
  if (!result) notFound();
  if ("error" in result) return result.error;
  const path = `${base}/${operation === "deleteCategory" ? "categories" : "products"}`;
  revalidatePath(path);
  redirect(path);
}
