import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/site-header";
import { BrandStage } from "@/components/brand-stage";
import { copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";

export function AuthShell({ locale, path, children }: { locale: Locale; path: string; children: ReactNode }) {
  const ar = locale === "ar";
  const alt = otherLocale(locale);
  const title = ar ? "كل تفاصيل تجارتك، في واجهة واحدة." : "Your entire business, in one place.";
  const detail = ar ? "من إنشاء متجرك وتخصيص هويته، إلى إدارة المنتجات والطلبات والاشتراكات." : "Create and customize your store, then manage products, orders, and subscriptions.";
  return <main className="wajhati-platform wajhati-auth">
    <div className="wajhati-auth-main"><div className="wajhati-auth-column">
      <header><Brand locale={locale} /><Link href={`/${alt}${path}`} lang={alt} hrefLang={alt}>{copy[locale].switchLanguage}</Link></header>
      <p className="wajhati-auth-badge">{ar ? "منصة المتاجر العربية" : "Online store platform"}</p>
      <div className="wajhati-auth-form">{children}</div>
    </div><footer>{copy[locale].brand} · {ar ? "إدارة متجرك بسهولة" : "Manage your store with ease"}</footer></div>
    <aside className="wajhati-auth-aside">
      <div><p className="wajhati-auth-brand-line">واجهتي / WAJHATI</p><h2>{title}</h2><p>{detail}</p>
        <BrandStage locale={locale} />
      </div>
    </aside>
  </main>;
}
