import { Globe2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import brandArtwork from "@/assets/wajhati/brand-artwork.jpg";
import { copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";

export function Brand({ locale }: { locale: Locale }) {
  return (
    <Link href={`/${locale}`} className="inline-flex min-h-11 shrink-0 items-center gap-2.5 text-xl font-bold">
      <span className="wajhati-brand-mark" aria-hidden="true">
        <Image src={brandArtwork} alt="" sizes="132px" className="wajhati-brand-artwork" />
      </span>
      <span className="wajhati-brand-name">{copy[locale].brand}</span>
    </Link>
  );
}

export function SiteHeader({ locale, path = "", children }: { locale: Locale; path?: string; children?: ReactNode }) {
  const alternate = otherLocale(locale);
  return (
    <header className="border-b border-line bg-white/85">
      <nav className="shell flex min-h-16 flex-wrap items-center justify-between gap-2 py-2.5">
        <Brand locale={locale} />
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Link href={`/${alternate}${path}`} hrefLang={alternate} lang={alternate} className="inline-flex min-h-11 items-center gap-1.5 px-1.5 text-sm font-bold text-muted hover:text-brand">
            <Globe2 size={16} aria-hidden="true" /> {copy[locale].switchLanguage}
          </Link>
          {children}
        </div>
      </nav>
    </header>
  );
}
