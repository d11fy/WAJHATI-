"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import type { CatalogFilters } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import type { Locale } from "@/lib/i18n";

export function MerchantFilters({ path, locale, filters, categories }: {
  path: string; locale: Locale; filters: CatalogFilters; categories: { value: string; name: string }[];
}) {
  const ar = locale === "ar";
  const t = catalogCopy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const active = Number(Boolean(filters.category)) + Number(Boolean(filters.state)) +
    Number(filters.sort !== "featured") + Number(filters.availableOnly);
  const label = ar ? "الفلاتر" : "Filters";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const search = new URLSearchParams();
    for (const [name, value] of data) if (typeof value === "string" && value) search.set(name, value);
    dialog.current?.close();
    startTransition(() => router.push(search.size ? `${path}?${search}` : path));
  }
  return <div className="wajhati-merchant-filters">
    <form method="get" action={path} className="wajhati-product-search" onSubmit={submit}>
      <input type="search" className="control" name="q" maxLength={80} value={query}
        aria-label={t.search} placeholder={ar ? "ابحث في المنتجات" : "Search products"} onChange={(event) => setQuery(event.target.value)} />
      <input type="hidden" name="category" value={filters.category} />
      <input type="hidden" name="state" value={filters.state ?? ""} />
      <input type="hidden" name="sort" value={filters.sort} />
      {filters.availableOnly && <input type="hidden" name="available" value="1" />}
      <button type="submit" aria-label={t.search} title={t.search} disabled={pending}><Search size={19} aria-hidden="true" /></button>
    </form>
    <button type="button" className="button button-secondary wajhati-filter-toggle" aria-haspopup="dialog" disabled={pending} onClick={() => dialog.current?.showModal()}>
      <SlidersHorizontal size={18} aria-hidden="true" />{label}
      {active > 0 && <span className="tag">{new Intl.NumberFormat(locale).format(active)}</span>}
    </button>
    <p className={pending ? "wajhati-filter-loading" : "sr-only"} role="status">{pending ? t.loading : ""}</p>
    {(filters.q || active > 0) && <Link className="wajhati-filter-reset" href={path}>{ar ? "مسح البحث والفلاتر" : "Clear search and filters"}</Link>}
    <dialog ref={dialog} className="wajhati-filter-dialog" aria-labelledby="catalog-filter-title"
      onClose={(event) => event.currentTarget.querySelector("form")?.reset()}>
      <div className="wajhati-filter-dialog-header">
        <h2 id="catalog-filter-title">{ar ? "تصفية المنتجات" : "Filter products"}</h2>
        <button type="button" className="button button-secondary" aria-label={ar ? "إغلاق" : "Close"} onClick={() => dialog.current?.close()}><X size={18} aria-hidden="true" /></button>
      </div>
      <form method="get" action={path} className="wajhati-filter-fields" onSubmit={submit}>
        <input type="hidden" name="q" value={query} />
        <label className="field">{t.categories}<select className="control" name="category" defaultValue={filters.category}>
          <option value="">{t.all}</option>{categories.map(({ value, name }) => <option key={value} value={value}>{name}</option>)}
        </select></label>
        <label className="field">{t.status}<select className="control" name="state" defaultValue={filters.state ?? ""}>
          <option value="">{t.all}</option>{(["draft", "published", "archived"] as const).map((state) => <option key={state} value={state}>{t[state]}</option>)}
        </select></label>
        <label className="field">{t.sort}<select className="control" name="sort" defaultValue={filters.sort}>
          <option value="featured">{t.defaultSort}</option><option value="price-asc">{t.priceAsc}</option>
          <option value="price-desc">{t.priceDesc}</option><option value="newest">{t.newest}</option>
        </select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" className="accent-brand" name="available" value="1" defaultChecked={filters.availableOnly} />{t.availableOnly}</label>
        <button className="button button-primary">{t.apply}</button>
      </form>
    </dialog>
  </div>;
}
