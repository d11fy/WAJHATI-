import { LayoutGrid, LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site-header";
import { copy } from "@/lib/copy";
import type { Locale } from "@/lib/i18n";
import { signOut } from "@/server/auth/actions";

export function DashboardFrame({ locale, path = "/dashboard", children }: { locale: Locale; path?: string; children: ReactNode }) {
  const t = copy[locale];
  return (
    <div className="wajhati-platform">
      <SiteHeader locale={locale} path={path}>
        <form action={signOut.bind(null, locale)}>
          <button className="button button-secondary"><LogOut size={16} aria-hidden="true" />{t.signOut}</button>
        </form>
      </SiteHeader>
      <main className="shell py-7 sm:py-10">
        <Link className="mb-6 inline-flex min-h-9 items-center gap-2 text-sm font-bold text-brand" href={`/${locale}/dashboard`}>
          <LayoutGrid size={16} aria-hidden="true" />{t.dashboard}
        </Link>
        {children}
      </main>
    </div>
  );
}
