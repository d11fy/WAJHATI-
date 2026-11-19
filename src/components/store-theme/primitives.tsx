import { ArrowRight, Calculator, Eye, Globe2, Hash, ImageOff, Languages, MessageCircle, Store as StoreIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { publicImagePath } from "@/components/catalog/catalog-ui";
import { AddToCart, CartLink } from "@/components/orders/cart";
import { QuickAdd } from "@/components/orders/quick-add";
import { DemoAddToCart, DemoCartLink } from "@/components/demo-cart";
import { formatPrice, localizedValue, type CatalogFilters, type Currency } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { storeChromeCopy } from "@/lib/store-chrome-copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { designAssetPath, isFamilyTheme, type ThemeConfig, type FamilyThemeId } from "@/lib/theme-config";
import { themeCopy } from "@/lib/theme-copy";
import { orderCopy } from "@/lib/order-copy";
import type { ProductDetail } from "@/server/catalog/public";
import type { Highlights, ThemeCategory, ThemeProduct } from "@/server/themes/public";

type Store = { slug: string; name: string; country: string; currency: Currency };
type Contact = { storeId: string; accepting: boolean; links: { whatsapp: string | null; instagram: string | null } | null };
export type Base = { locale: Locale; store: Store; design: ThemeConfig; preview?: boolean; contact?: Contact | null; demo?: { theme: FamilyThemeId; banner: string } };
export type Home = Base & {
  products: ThemeProduct[]; categories: ThemeCategory[]; highlights: Promise<Highlights> | Highlights;
  filters: CatalogFilters; hasNext: boolean;
};
export type Detail = Base & { product: ProductDetail };

export const publicPath = (locale: Locale, slug: string) => `/${locale}/s/${slug}`;
export const storePath = (base: Base, locale = base.locale) => base.demo ? `/${locale}/demo/${base.demo.theme}` : publicPath(locale, base.store.slug);
export const mediaPath = (base: Base, id: string) => base.demo ? id : publicImagePath(base.store.slug, id);
const previewPath = (locale: Locale, slug: string) => `/${locale}/dashboard/stores/${slug}/design/preview`;

export function ThemeSurface({ design, children }: { design: ThemeConfig; children: ReactNode }) {
  const style = {
    "--store-bg": design.colors.background, "--store-ink": design.colors.text,
    "--store-accent": design.colors.accent, "--store-on-accent": design.colors.onAccent,
  } as CSSProperties;
  return <div className={isFamilyTheme(design.theme) ? "store-theme store-family" : "store-theme"} data-theme={design.theme} data-font={design.font} style={style}>{children}</div>;
}

export function Picture({ source, alt, className = "", eager = false, children }: { source: string | null; alt: string; className?: string; eager?: boolean; children?: ReactNode }) {
  return <div className={`store-picture ${className}`}>
    {source ? <Image src={source} alt={alt} fill unoptimized loading={eager ? "eager" : "lazy"} /> : <ImageOff size={26} aria-hidden="true" />}
    {children}
  </div>;
}

function Brand({ base }: { base: Base }) {
  const { locale, store, design, preview } = base;
  const href = preview ? previewPath(locale, store.slug) : storePath(base);
  return <Link className="store-brand" href={href}>
    {design.assets.logo ? <span className="store-logo"><Image src={designAssetPath(store.slug, design.assets.logo, preview)} alt="" fill unoptimized /></span>
      : <span className="store-brand-mark"><StoreIcon size={20} aria-hidden="true" /></span>}
    <bdi>{store.name}</bdi>
  </Link>;
}

function Navigation({ base, home }: { base: Base; home: boolean }) {
  const { locale, store, design, preview } = base;
  const t = themeCopy[locale];
  const root = preview ? previewPath(locale, store.slug) : storePath(base);
  return <nav className="store-navigation" aria-label={t.store}>
    {design.sections.filter((section) => section.visible && !["hero", "editorial", "comparison"].includes(section.id)).map(({ id }) => (
      <Link key={id} href={`${home && id === "products" ? "" : root}#theme-${id}`}>{t[id === "editorial" ? "editorialSection" : id]}</Link>
    ))}
    {preview && <span className="store-preview-label">{t.draft}</span>}
  </nav>;
}

function Language({ base, product, cart }: { base: Base; product?: string; cart?: boolean }) {
  const alternate = otherLocale(base.locale);
  const root = base.preview ? previewPath(alternate, base.store.slug) : storePath(base, alternate);
  return <Link className="store-language" href={product ? `${root}/p/${product}` : cart ? `${root}/cart` : root} hrefLang={alternate} lang={alternate}>
    <Globe2 size={16} aria-hidden="true" />{alternate === "en" ? "English" : "العربية"}
  </Link>;
}

export function Header({ base, product, editorial = false, cart = false }: { base: Base; product?: string; editorial?: boolean; cart?: boolean }) {
  const tools = <div className="store-tools"><Language base={base} product={product} cart={cart} />
    {base.demo && <DemoCartLink theme={base.demo.theme} locale={base.locale} />}
    {base.contact && <CartLink storeId={base.contact.storeId} slug={base.store.slug} locale={base.locale} accepting={base.contact.accepting || cart} />}</div>;
  return <>
    <AnnouncementBar base={base} />
    <a className="store-skip" href="#theme-main">{themeCopy[base.locale].skip}</a>
    {editorial ? <header className="store-masthead">
      <div className="store-masthead-main store-width"><span className="store-market">{new Intl.DisplayNames(base.locale, { type: "region" }).of(base.store.country)}</span><Brand base={base} />{tools}</div>
      <div className="store-ribbon"><Navigation base={base} home={!product && !cart} /></div>
    </header> : <header className="store-header">
      <div className="store-width store-header-inner"><Brand base={base} /><Navigation base={base} home={!product && !cart} />{tools}</div>
    </header>}
  </>;
}

export function Footer({ base, editorial = false }: { base: Base; editorial?: boolean }) {
  const { store, locale } = base;
  return <>
    <TrustStrip base={base} />
    <footer className={editorial ? "store-footer store-footer-editorial" : "store-footer"}>
    <div className="store-width store-footer-inner">
      <Brand base={base} />
      <span className="store-market">{new Intl.DisplayNames(locale, { type: "region" }).of(store.country)} <span aria-hidden="true">·</span> <bdi>{store.currency}</bdi></span>
      {base.contact?.links && <div className="store-contact-links">
        {(["whatsapp", "instagram"] as const).map((channel) => {
          const url = base.contact?.links?.[channel];
          return url && <a key={channel} href={url} rel="noreferrer">{orderCopy[locale][channel]}</a>;
        })}
      </div>}
      <small>{themeCopy[locale].builtWith}</small>
    </div>
  </footer>
    <ContactButton base={base} />
  </>;
}

/** True when visitors can really order: the live store accepts orders through a published channel, or this is the demo store. */
const orderChannels = (base: Base) => Boolean(base.demo) || Boolean(base.contact?.accepting && base.contact.links && (base.contact.links.whatsapp || base.contact.links.instagram));

/** A single quiet line above the header: how orders reach the store. Only shown when the store really accepts orders. */
function AnnouncementBar({ base }: { base: Base }) {
  if (!orderChannels(base)) return null;
  const chrome = storeChromeCopy[base.locale];
  return <p className="store-announcement"><MessageCircle size={15} aria-hidden="true" /><span>{chrome.announcement}</span><span className="store-announcement-note">{chrome.announcementNote}</span></p>;
}

/** Facts about how ordering works on every WAJHATI store; nothing here is a claim about this particular merchant. */
function TrustStrip({ base }: { base: Base }) {
  if (!orderChannels(base)) return null;
  const chrome = storeChromeCopy[base.locale];
  const icons = [MessageCircle, Hash, Calculator, Languages];
  return <section className="store-trust" aria-label={chrome.trustLabel}>
    <ul className="store-width">{chrome.trust.map((item, index) => { const Icon = icons[index]; return <li key={item}><Icon size={18} aria-hidden="true" /><span>{item}</span></li>; })}</ul>
  </section>;
}

/** Floating contact button, shown only when the merchant published a WhatsApp link. */
function ContactButton({ base }: { base: Base }) {
  const url = base.contact?.links?.whatsapp;
  if (!url || base.preview) return null;
  return <a className="store-contact-fab" href={url} target="_blank" rel="noopener noreferrer" aria-label={storeChromeCopy[base.locale].whatsapp}><MessageCircle size={26} aria-hidden="true" /></a>;
}

export function StorePrice({ base, product }: { base: Base; product: Pick<ThemeProduct, "priceMinor" | "compareAtMinor"> }) {
  const currency = base.store.currency;
  return <span className="store-price">
    <bdi>{formatPrice(product.priceMinor, currency, base.locale)}</bdi>
    {product.compareAtMinor !== null && <del><bdi>{formatPrice(product.compareAtMinor, currency, base.locale)}</bdi></del>}
  </span>;
}

export function ProductTile({ base, product }: { base: Base; product: ThemeProduct }) {
  const { locale, store, preview } = base;
  const name = localizedValue(locale, product.nameAr, product.nameEn);
  const source = preview || base.demo ? product.imageSrc ?? null : product.imageId ? publicImagePath(store.slug, product.imageId) : null;
  const chrome = storeChromeCopy[locale];
  const saving = product.compareAtMinor !== null && product.compareAtMinor > product.priceMinor ? Math.round((1 - product.priceMinor / product.compareAtMinor) * 100) : 0;
  const content = <>
    <Picture source={source} alt="">
      {saving > 0 && product.available && <span className="store-badge store-badge-sale">{chrome.save} <bdi>{new Intl.NumberFormat(locale, { style: "percent" }).format(saving / 100)}</bdi></span>}
      {!preview && <span className="store-tile-action" aria-hidden="true"><Eye size={15} />{chrome.view}</span>}
    </Picture>
    <div className="store-product-caption">
      <h3><bdi>{name}</bdi></h3>
      <StorePrice base={base} product={product} />
      {!product.available && <span className="store-stock">{catalogCopy[locale].unavailableItem}</span>}
      {!preview && product.available && <span className="store-tile-cta" aria-hidden="true">{chrome.view}<ArrowRight size={15} className="arrow" /></span>}
    </div>
  </>;
  return <li className="store-tile" data-available={product.available}>{preview ? <article>{content}</article> : <Link href={`${storePath(base)}/p/${product.slug}`}>{content}</Link>}
    {!preview && !base.demo && product.available && base.contact?.accepting && <QuickAdd storeId={base.contact.storeId} store={store.slug} product={product.slug} locale={locale} />}
  </li>;
}

export function CategoryShowcase({ base, items }: { base: Base; items: ThemeCategory[] }) {
  return <ul className="store-category-grid">
    {items.map((category) => {
      const source = base.preview || base.demo ? category.imageSrc : category.imageId && publicImagePath(base.store.slug, category.imageId);
      const content = <>{source && <Picture source={source} alt="" />}<bdi>{localizedValue(base.locale, category.nameAr, category.nameEn)}</bdi></>;
      return <li key={category.slug}>{base.preview ? <div>{content}</div> : <Link href={`${storePath(base)}?category=${category.slug}#theme-products`}>{content}</Link>}</li>;
    })}
  </ul>;
}

export function Details({ data, name, showHeading = true, showDescription = true }: {
  data: Detail; name: string; showHeading?: boolean; showDescription?: boolean;
}) {
  const { locale, product } = data;
  const t = catalogCopy[locale];
  const description = localizedValue(locale, product.descriptionAr ?? "", product.descriptionEn);
  return <section className="store-detail-info">
    <span className="store-stock">{product.available ? t.available : t.unavailableItem}</span>
    {showHeading && <h1 dir="auto">{name}</h1>}
    <StorePrice base={data} product={product} />
    {showDescription && description && <p dir="auto">{description}</p>}
    {data.demo && product.available ? <DemoAddToCart theme={data.demo.theme} product={product.slug} groups={product.options} locale={locale} /> : data.contact?.accepting && product.available ? <AddToCart storeId={data.contact.storeId} product={product.slug} groups={product.options} locale={locale} />
      : product.options.length > 0 && <div className="store-options">
      <h2>{t.options}</h2>
      {product.options.map((option) => <label key={option.name}><bdi>{option.name}</bdi>
        <select dir="auto">{option.values.map((value) => <option key={value}>{value}</option>)}</select>
      </label>)}
    </div>}
  </section>;
}
