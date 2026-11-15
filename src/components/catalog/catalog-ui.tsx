import { Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import home from "@/assets/wajhati/workspace-home.svg";
import box from "@/assets/wajhati/workspace-package.svg";
import grid from "@/assets/wajhati/workspace-grid.svg";
import chat from "@/assets/wajhati/workspace-message.svg";
import design from "@/assets/wajhati/workspace-design.svg";
import credit from "@/assets/wajhati/workspace-credit.svg";
import settings from "@/assets/wajhati/workspace-settings.svg";
import { billingCopy } from "@/lib/billing-copy";
import { WorkspaceFrame, type WorkspaceLink } from "@/components/workspace-frame";
import { catalogCopy } from "@/lib/catalog-copy";
import { formatPrice, type CatalogFilters, type Currency } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import { themeCopy } from "@/lib/theme-copy";
import { orderCopy } from "@/lib/order-copy";
import { copy } from "@/lib/copy";

export function CatalogFrame({ locale, slug, path, children, storeName, showBilling }: {
  locale: Locale; slug: string; path: string; children: ReactNode; storeName?: string; showBilling?: boolean;
}) {
  const t = catalogCopy[locale];
  const store = `/dashboard/stores/${slug}`;
  const links: WorkspaceLink[] = [
    { path: store, label: copy[locale].overview, icon: home, exact: true, tab: true },
    { path: `${store}/products`, label: t.products, icon: box, tab: true },
    { path: `${store}/categories`, label: t.categories, icon: grid },
    { path: `${store}/orders`, label: orderCopy[locale].orders, icon: chat, tab: true },
    { path: `${store}/design`, label: themeCopy[locale].design, icon: design },
    ...(showBilling || path === "/billing" ? [{ path: `${store}/billing`, label: billingCopy[locale].title, icon: credit }] : []),
    { path: `${store}/contact`, label: orderCopy[locale].contact, icon: settings, tab: true },
    { path: "/dashboard", label: copy[locale].yourStores, icon: home, exact: true },
  ];
  return <WorkspaceFrame locale={locale} path={`${store}${path}`} title={storeName ?? slug} links={links}>{children}</WorkspaceFrame>;
}

export function CatalogImage({ src, alt, className = "" }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={`relative grid aspect-[4/3] place-items-center overflow-hidden bg-leaf text-brand ${className}`}>
      {src ? <Image src={src} alt={alt} fill unoptimized className="object-cover" /> : <Package aria-hidden="true" size={30} />}
    </div>
  );
}

export function Price({ value, previous, currency, locale }: { value: number; previous?: number | null; currency: Currency; locale: Locale }) {
  return <span className="inline-flex flex-wrap items-baseline gap-2 font-extrabold">
    <bdi>{formatPrice(value, currency, locale)}</bdi>
    {previous != null && <del className="text-sm font-semibold text-muted"><bdi>{formatPrice(previous, currency, locale)}</bdi></del>}
  </span>;
}

export function CatalogFilter({ path, locale, filters, categories, merchant = false }: {
  path: string; locale: Locale; filters: CatalogFilters; categories: { value: string; name: string }[]; merchant?: boolean;
}) {
  const t = catalogCopy[locale];
  return (
    <form method="get" action={path} className="panel my-5 grid items-end gap-3 p-4 sm:grid-cols-2 lg:flex lg:flex-wrap">
      <label className="field grow">{t.search}<input type="search" className="control" name="q" maxLength={80} defaultValue={filters.q} /></label>
      <label className="field">{t.categories}<select className="control" name="category" defaultValue={filters.category}>
        <option value="">{t.all}</option>{categories.map(({ value, name }) => <option key={value} value={value}>{name}</option>)}
      </select></label>
      {merchant && <label className="field">{t.status}<select className="control" name="state" defaultValue={filters.state ?? ""}>
        <option value="">{t.all}</option>{(["draft", "published", "archived"] as const).map((state) => <option key={state} value={state}>{t[state]}</option>)}
      </select></label>}
      <label className="field">{t.sort}<select className="control" name="sort" defaultValue={filters.sort}>
        <option value="featured">{t.defaultSort}</option><option value="price-asc">{t.priceAsc}</option>
        <option value="price-desc">{t.priceDesc}</option><option value="newest">{t.newest}</option>
      </select></label>
      <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" className="accent-brand" name="available" value="1" defaultChecked={filters.availableOnly} />{t.availableOnly}</label>
      <button className="button button-primary">{t.apply}</button>
    </form>
  );
}

export function Pagination({ path, locale, filters, hasNext }: { path: string; locale: Locale; filters: CatalogFilters; hasNext: boolean }) {
  const t = catalogCopy[locale];
  function href(page: number) {
    const query = new URLSearchParams({ page: String(page), sort: filters.sort });
    if (filters.q) query.set("q", filters.q);
    if (filters.category) query.set("category", filters.category);
    if (filters.state) query.set("state", filters.state);
    if (filters.availableOnly) query.set("available", "1");
    return `${path}?${query}`;
  }
  if (filters.page === 1 && !hasNext) return null;
  return <nav className="mt-6 flex flex-wrap items-center gap-3" aria-label={t.products}>
    {filters.page > 1 && <Link className="button button-secondary" href={href(filters.page - 1)}>{t.previous}</Link>}
    <span className="tag" aria-current="page">{new Intl.NumberFormat(locale).format(filters.page)}</span>
    {hasNext && <Link className="button button-secondary" href={href(filters.page + 1)}>{t.next}</Link>}
  </nav>;
}

export const publicImagePath = (store: string, image: string) => `/api/store-media/${store}/${image}`;
export const privateImagePath = (store: string, kind: "category" | "product", id: string) => `/api/catalog/${store}/${kind}/${id}`;
