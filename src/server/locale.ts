import "server-only";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";

export async function routeLocale(params: Promise<{ locale: string }>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
