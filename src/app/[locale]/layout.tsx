import "@fontsource-variable/noto-sans-arabic";
import "@fontsource-variable/cairo";
import "@fontsource-variable/manrope";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
import "@fontsource/poppins/latin-800.css";
import "@fontsource/poppins/latin-900.css";
import "@fontsource/amiri/400.css";
import "@fontsource/amiri/700.css";
import "../globals.css";
import "../platform-ui.css";
import "../marketing.css";
import "../legal.css";
import "../identity-ui.css";
import "../workspace-ui.css";
import "../storefront.css";
import "../storefront-families.css";
import "../premium-ui.css";
import "../marketing-polish.css";
import "../premium-storefront.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { locales } from "@/lib/i18n";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = await routeLocale(params);
  const brand = locale === "ar" ? "واجهتي" : "WAJHATI";
  return {
    title: { default: locale === "ar" ? "واجهتي | WAJHATI" : "WAJHATI | واجهتي", template: `%s · ${brand}` },
    description: locale === "ar" ? "منصة إنشاء المتاجر الإلكترونية" : "A platform for creating online stores",
  };
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = await routeLocale(params);
  return <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}><body>{children}</body></html>;
}
