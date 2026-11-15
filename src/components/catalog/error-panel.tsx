"use client";

import { useParams } from "next/navigation";
import { catalogCopy } from "@/lib/catalog-copy";

export default function CatalogErrorPanel({ reset, platform = false }: { reset: () => void; platform?: boolean }) {
  const { locale } = useParams<{ locale: string }>();
  const t = catalogCopy[locale === "en" ? "en" : "ar"];
  return <main className={platform ? "wajhati-platform p-5 sm:p-10" : "shell py-10"}>
    <div className={platform ? "panel mx-auto max-w-xl p-6" : "panel p-6"}>
      <h1 className="mb-4 text-xl font-black" role="alert">{t.unavailable}</h1>
      <button type="button" className="button button-primary" onClick={reset}>{t.retry}</button>
    </div>
  </main>;
}
