import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { Globe2, LogOut, Menu } from "lucide-react";
import type { ReactNode } from "react";
import home from "@/assets/wajhati/workspace-home.svg";
import settings from "@/assets/wajhati/workspace-settings.svg";
import { Brand } from "@/components/site-header";
import { copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { signOut } from "@/server/auth/actions";

export type WorkspaceLink = { path: string; label: string; icon: StaticImageData; exact?: boolean; tab?: boolean };

export function MerchantWorkspace({ locale, path, children }: { locale: Locale; path: string; children: ReactNode }) {
  const t = copy[locale];
  return <WorkspaceFrame locale={locale} path={path} title={t.dashboard} links={[
    { path: "/dashboard", label: t.yourStores, icon: home, exact: true },
    { path: "/account", label: locale === "ar" ? "أمان الحساب" : "Account security", icon: settings },
  ]}>{children}</WorkspaceFrame>;
}

export function WorkspaceFrame({ locale, path, title, links, children }: {
  locale: Locale; path: string; title: string; links: WorkspaceLink[]; children: ReactNode;
}) {
  const ar = locale === "ar";
  const alt = otherLocale(locale);
  const tabs = links.filter((link) => link.tab);
  const current = path.split("?")[0];
  const active = (item: WorkspaceLink) => current === item.path || (!item.exact && current.startsWith(`${item.path}/`));
  const navigation = (items: WorkspaceLink[]) => items.map((item) => <Link key={item.path} href={`/${locale}${item.path}`} aria-current={active(item) ? "page" : undefined}>
    <Image src={item.icon} alt="" unoptimized /><span>{item.label}</span>
  </Link>);
  const label = ar ? "تنقل مساحة العمل" : "Workspace navigation";
  return <div className={`wajhati-platform wajhati-workspace${tabs.length ? " wajhati-workspace-has-tabs" : ""}`}>
    <aside className="wajhati-workspace-rail">
      <Brand locale={locale} /><p dir="auto">{title}</p>
      <nav aria-label={label}>{navigation(links)}</nav>
    </aside>
    <div className="wajhati-workspace-pane" key={current}>
      <header className="wajhati-workspace-header"><div>
        <span className="wajhati-workspace-title" dir="auto">{title}</span><div className="wajhati-workspace-mobile-brand"><Brand locale={locale} /></div>
        <div className="wajhati-workspace-tools">
          <Link href={`/${alt}${path}`} hrefLang={alt} lang={alt} aria-label={copy[locale].switchLanguage}><Globe2 size={18} aria-hidden="true" /></Link>
          <form action={signOut.bind(null, locale)}><button aria-label={copy[locale].signOut} title={copy[locale].signOut}><LogOut size={18} aria-hidden="true" /></button></form>
          <details key={current} className="wajhati-workspace-menu"><summary aria-label={label}><Menu size={22} aria-hidden="true" /></summary><nav aria-label={label}>{navigation(links)}</nav></details>
        </div>
      </div></header>
      <main className="wajhati-workspace-content">{children}</main>
    </div>
    {tabs.length > 0 && <nav className="wajhati-workspace-tabs" aria-label={label}>{navigation(tabs)}</nav>}
  </div>;
}
