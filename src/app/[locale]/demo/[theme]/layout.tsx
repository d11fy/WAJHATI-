import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { routeLocale } from "@/server/locale";
import { isDemoTheme } from "@/lib/demo-catalog";
import { familyThemeIds, themeRegistry } from "@/lib/theme-config";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function DemoLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string; theme: string }> }) {
  const { theme } = await params;
  const locale = await routeLocale(params);
  if (!isDemoTheme(theme)) notFound();
  const ar = locale === "ar";
  return <>
    <div className="wajhati-platform demo-toolbar"><Link href={`/${locale}#themes`}><ArrowRight size={16} className="arrow" aria-hidden="true" />{ar ? "واجهتي" : "WAJHATI"}</Link>
      <details><summary><bdi>{themeRegistry[theme].title}</bdi><ChevronDown size={15} aria-hidden="true" /></summary><nav aria-label={ar ? "اختيار ثيم الديمو" : "Choose demo theme"}>{familyThemeIds.map((id) => <Link href={`/${locale}/demo/${id}`} key={id} aria-current={id === theme ? "page" : undefined}>{themeRegistry[id].title}</Link>)}</nav></details>
      <p>{ar ? "متجر تجريبي · المنتجات والأسعار للتوضيح فقط" : "Demo store · Illustrative products and prices"}</p><Link href={`/${locale}/sign-in`} className="button button-primary">{ar ? "سجّل الدخول للبدء" : "Sign in to get started"}</Link>
    </div>
    {children}
  </>;
}
