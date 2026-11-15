"use client";

import { useParams } from "next/navigation";

export default function PlatformError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const arabic = useParams<{ locale: string }>().locale === "ar";
  return <main className="wajhati-platform p-5 sm:p-10"><section className="panel mx-auto grid max-w-lg gap-4 p-6">
    <h1 className="text-2xl font-black">{arabic ? "تعذر تحميل إدارة المنصة" : "Platform administration could not load"}</h1>
    <button className="button button-primary w-fit" onClick={reset}>{arabic ? "أعد المحاولة" : "Try again"}</button>
  </section></main>;
}
