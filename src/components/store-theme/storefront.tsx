import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { CatalogFilter, Pagination, publicImagePath } from "@/components/catalog/catalog-ui";
import { localizedValue } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { designAssetPath, isFamilyTheme, type FamilyThemeId, type ThemeId, type ThemeSection } from "@/lib/theme-config";
import { themeCopy } from "@/lib/theme-copy";
import { orderCopy } from "@/lib/order-copy";
import { FamilyCart, FamilyHome, FamilyProduct } from "./family-pages";
import { CategoryShowcase, Details, Footer, Header, Picture, ProductTile, ThemeSurface, publicPath, type Base, type Detail, type Home } from "./primitives";

function Hero({ base, editorial = false }: { base: Base; editorial?: boolean }) {
  const { store, locale, design, preview } = base;
  const title = locale === "en" ? design.hero.titleEn || design.hero.titleAr : design.hero.titleAr || design.hero.titleEn;
  const description = locale === "en" ? design.hero.descriptionEn || design.hero.descriptionAr : design.hero.descriptionAr || design.hero.descriptionEn;
  const banner = design.assets.banner ? designAssetPath(store.slug, design.assets.banner, preview) : null;
  return <section id="theme-hero" className={editorial ? "store-hero store-hero-editorial" : "store-hero store-hero-grid"}>
    <div className="store-hero-text">
      {editorial && <span className="store-ornament" aria-hidden="true" />}
      <h1 dir="auto">{title || store.name}</h1>
      {description && <p dir="auto">{description}</p>}
      <a className="store-cta" href="#theme-products">{themeCopy[locale].browse}<ArrowRight size={17} className="arrow" aria-hidden="true" /></a>
    </div>
    {banner && <Picture source={banner} alt="" className="store-banner" eager />}
  </section>;
}

async function HighlightsSection({ data, section }: { data: Home; section: "categories" | "featured" }) {
  const highlights = await data.highlights;
  const t = themeCopy[data.locale];
  const categorySection = section === "categories";
  if (!(categorySection ? highlights.categories.length : highlights.products.length)) return null;
  return <section id={`theme-${section}`} className="store-section" aria-labelledby={`theme-${section}-title`}>
    <h2 id={`theme-${section}-title`}>{t[section]}</h2>
    {categorySection ? <CategoryShowcase base={data} items={highlights.categories} />
      : <ul className="store-product-grid store-feature-grid">{highlights.products.map((product) => <ProductTile key={product.slug} base={data} product={product} />)}</ul>}
  </section>;
}

function ProductsSection({ data }: { data: Home }) {
  const { locale, store, preview, filters } = data;
  const t = themeCopy[locale];
  const path = publicPath(locale, store.slug);
  return <section id="theme-products" className="store-section" aria-labelledby="theme-products-title">
    <h2 id="theme-products-title">{t.products}</h2>
    {!preview && <CatalogFilter path={path} locale={locale} filters={filters} categories={data.categories.map((category) => ({ value: category.slug, name: localizedValue(locale, category.nameAr, category.nameEn) }))} />}
    {data.products.length ? <ul className="store-product-grid">{data.products.map((product) => <ProductTile key={product.slug} base={data} product={product} />)}</ul>
      : <div className="store-empty"><p>{preview ? t.noProducts : catalogCopy[locale].noResults}</p>{!preview && <Link href={path}>{t.reset}</Link>}</div>}
    {!preview && <Pagination path={path} locale={locale} filters={filters} hasNext={data.hasNext} />}
  </section>;
}

function HomeSections({ data, editorial = false }: { data: Home; editorial?: boolean }) {
  const filtered = Boolean(data.filters.q || data.filters.category || data.filters.availableOnly || data.filters.page > 1);
  function section(id: ThemeSection) {
    if (id === "hero") return <Hero key={id} base={data} editorial={editorial} />;
    if (id === "products") return <ProductsSection key={id} data={data} />;
    if (id !== "categories" && id !== "featured") return null;
    if (filtered) return null;
    return <Suspense key={id} fallback={<div className="store-section store-skeleton" role="status"><span className="sr-only">{themeCopy[data.locale].loading}</span></div>}>
      <HighlightsSection data={data} section={id} />
    </Suspense>;
  }
  return <>
    {!data.design.sections.some(({ id, visible }) => id === "hero" && visible) && <h1 className="store-hidden-hero-title" dir="auto">{data.store.name}</h1>}
    {data.design.sections.filter(({ visible }) => visible).map(({ id }) => section(id))}
  </>;
}

function MinimalHome(data: Home) {
  return <ThemeSurface design={data.design}><Header base={data} />
    <main className="store-width store-main" id="theme-main"><HomeSections data={data} /></main><Footer base={data} />
  </ThemeSurface>;
}

function LuxuryHome(data: Home) {
  return <ThemeSurface design={data.design}><Header base={data} editorial />
    <main className="store-editorial-main" id="theme-main"><HomeSections data={data} editorial /></main><Footer base={data} editorial />
  </ThemeSurface>;
}

function Gallery({ data, name }: { data: Detail; name: string }) {
  const { store, product, locale } = data;
  return <div className="store-gallery">
    <Picture source={product.images[0] ? publicImagePath(store.slug, product.images[0]) : null} alt={name} eager />
    {product.images.length > 1 && <ul>{product.images.slice(1).map((id, index) => <li key={id}><Picture source={publicImagePath(store.slug, id)} alt={`${name} · ${catalogCopy[locale].image} ${index + 2}`} /></li>)}</ul>}
  </div>;
}

function Back({ data }: { data: Detail }) {
  return <Link className="store-back" href={publicPath(data.locale, data.store.slug)}>{themeCopy[data.locale].back}</Link>;
}

function MinimalDetail(data: Detail) {
  const name = localizedValue(data.locale, data.product.nameAr, data.product.nameEn);
  return <ThemeSurface design={data.design}><Header base={data} product={data.product.slug} />
    <main className="store-width store-detail-main" id="theme-main"><Back data={data} />
      <div className="store-detail-grid"><Gallery data={data} name={name} /><Details data={data} name={name} /></div>
    </main><Footer base={data} />
  </ThemeSurface>;
}

function LuxuryDetail(data: Detail) {
  const name = localizedValue(data.locale, data.product.nameAr, data.product.nameEn);
  return <ThemeSurface design={data.design}><Header base={data} product={data.product.slug} editorial />
    <main className="store-detail-main store-detail-editorial" id="theme-main"><Back data={data} />
      <div className="store-detail-grid"><div className="store-detail-editorial-copy"><span className="store-ornament" aria-hidden="true" /><Details data={data} name={name} /></div>
        <Gallery data={data} name={name} /></div>
    </main><Footer base={data} editorial />
  </ThemeSurface>;
}

const views = {
  "minimal-commerce": { Home: MinimalHome, Detail: MinimalDetail },
  "luxury-boutique": { Home: LuxuryHome, Detail: LuxuryDetail },
} satisfies Record<Exclude<ThemeId, FamilyThemeId>, { Home: (data: Home) => ReactNode; Detail: (data: Detail) => ReactNode }>;

export function ThemedHome(data: Home) {
  if (isFamilyTheme(data.design.theme)) return <FamilyHome data={data} family={data.design.theme} />;
  const View = views[data.design.theme].Home;
  return <View {...data} />;
}

export function ThemedProduct(data: Detail) {
  if (isFamilyTheme(data.design.theme)) return <FamilyProduct data={data} family={data.design.theme} />;
  const View = views[data.design.theme].Detail;
  return <View {...data} />;
}

export function ThemedCartFrame({ base, children }: { base: Base; children: ReactNode }) {
  if (isFamilyTheme(base.design.theme)) return <FamilyCart base={base} family={base.design.theme}>{children}</FamilyCart>;
  const editorial = base.design.theme === "luxury-boutique";
  return <ThemeSurface design={base.design}>
    <Header base={base} editorial={editorial} cart />
    <main id="theme-main" className="store-width store-cart-main">
      <Link className="store-back" href={publicPath(base.locale, base.store.slug)}>{orderCopy[base.locale].browse}</Link>
      <h1>{orderCopy[base.locale].cart}</h1>
      {children}
    </main>
    <Footer base={base} editorial={editorial} />
  </ThemeSurface>;
}
