import { ArrowRight, BookOpen, Gift, Layers3, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CatalogFilter, Pagination } from "@/components/catalog/catalog-ui";
import { localizedValue } from "@/lib/catalog";
import { catalogCopy } from "@/lib/catalog-copy";
import { orderCopy } from "@/lib/order-copy";
import { designAssetPath, type FamilyThemeId } from "@/lib/theme-config";
import { themeCopy } from "@/lib/theme-copy";
import { familyLabels } from "@/lib/theme-families";
import type { ThemeProduct } from "@/server/themes/public";
import { CategoryShowcase, Details, Footer, Header, Picture, ProductTile, StorePrice, ThemeSurface, storePath, mediaPath, type Base, type Detail, type Home } from "./primitives";

function productSource(data: Home, product: ThemeProduct) {
  return data.preview || data.demo ? product.imageSrc ?? null : product.imageId ? mediaPath(data, product.imageId) : null;
}

function familyContent(base: Base, family: FamilyThemeId) {
  const content = base.design.familyContent?.[family];
  return {
    kicker: localizedValue(base.locale, content?.kickerAr ?? "", content?.kickerEn ?? null),
    heading: localizedValue(base.locale, content?.headingAr ?? "", content?.headingEn ?? null),
    body: localizedValue(base.locale, content?.bodyAr ?? "", content?.bodyEn ?? null),
  };
}

function FamilyChrome({ base, family, product, cart, children }: {
  base: Base; family: FamilyThemeId; product?: string; cart?: boolean; children: ReactNode;
}) {
  return <ThemeSurface design={base.design}>
    {family !== "maison-wear" && <p className="family-market-line">
      {new Intl.DisplayNames(base.locale, { type: "region" }).of(base.store.country)} <span aria-hidden="true">·</span> <bdi>{base.store.currency}</bdi>
    </p>}
    <Header base={base} product={product} cart={cart} />
    {children}
    <Footer base={base} />
  </ThemeSurface>;
}

function HeroWords({ data, family }: { data: Home; family: FamilyThemeId }) {
  const { locale, design, store } = data;
  const { titleAr, titleEn, descriptionAr, descriptionEn } = design.hero;
  const title = localizedValue(locale, titleAr, titleEn) || store.name;
  const description = localizedValue(locale, descriptionAr, descriptionEn);
  const { kicker } = familyContent(data, family);
  return <div className="family-hero-copy">
    {kicker && <p className="family-kicker" dir="auto">{kicker}</p>}
    <h1 dir="auto">{title}</h1>
    {description && <p dir="auto">{description}</p>}
    <a href="#theme-products" className="store-cta">{familyLabels[locale][family].browse}<ArrowRight className="arrow" size={17} aria-hidden="true" /></a>
  </div>;
}

function MediaTiles({ data, products, className }: { data: Home; products: ThemeProduct[]; className: string }) {
  const pictures = products.filter((product) => productSource(data, product)).slice(0, 3);
  if (!pictures.length) return null;
  return <ul className={className} data-count={pictures.length}>
    {pictures.map((product) => {
      const name = localizedValue(data.locale, product.nameAr, product.nameEn);
      const picture = <Picture source={productSource(data, product)} alt={name} />;
      return <li key={product.slug}>{data.preview ? picture : <Link href={`${storePath(data)}/p/${product.slug}`}>{picture}</Link>}</li>;
    })}
  </ul>;
}

type HeroProps = { data: Home; family: FamilyThemeId; source: string | null; products: ThemeProduct[] };

function ElectroHero({ data, family, source, products }: HeroProps) {
  const promos = products.slice(0, 2);
  return <section id="theme-hero" className="family-tech-hero" data-promos={promos.length > 0}>
    <div className="family-hero family-tech-lead" data-image={Boolean(source)}>
      <HeroWords data={data} family={family} />
      {source && <Picture source={source} alt="" eager />}
    </div>
    {promos.length > 0 && <ul className="family-tech-promos">{promos.map((item) => <ProductTile key={item.slug} base={data} product={item} />)}</ul>}
  </section>;
}

function MaisonHero({ data, family, source }: HeroProps) {
  return <section id="theme-hero" className="family-hero family-cover" data-image={Boolean(source)}>
    {source && <Picture source={source} alt="" eager />}
    <HeroWords data={data} family={family} />
  </section>;
}

function AuraHero({ data, family, source }: HeroProps) {
  return <section id="theme-hero" className="family-hero family-ritual-hero" data-image={Boolean(source)}>
    {source && <Picture source={source} alt="" eager />}
    <HeroWords data={data} family={family} />
  </section>;
}

function LumaHero({ data, family, source, products }: HeroProps) {
  const extra = products.filter((product) => {
    const image = productSource(data, product);
    return image && image !== source;
  }).slice(0, 2);
  return <section id="theme-hero" className="family-hero family-gift-hero" data-image={Boolean(source)}>
    {source && <div className="family-gift-mosaic" data-extra={extra.length > 0}>
      <Picture source={source} alt="" eager />
      <MediaTiles data={data} products={extra} className="family-gift-small" />
    </div>}
    <HeroWords data={data} family={family} />
  </section>;
}

function DigitalHero({ data, family, source }: HeroProps) {
  return <section id="theme-hero" className="family-hero family-digital-hero" data-image={Boolean(source)}>
    {source && <div className="family-screen"><Picture source={source} alt="" eager /></div>}
    <HeroWords data={data} family={family} />
  </section>;
}

function LearningHero({ data, family, source }: HeroProps) {
  return <section id="theme-hero" className="family-hero family-learning-hero" data-image={Boolean(source)}>
    {source && <Picture source={source} alt="" eager />}
    <HeroWords data={data} family={family} />
  </section>;
}

const heroes = {
  "electro-x": ElectroHero, "maison-wear": MaisonHero, "aura-beauty": AuraHero,
  "luma-gifts": LumaHero, "digital-hub": DigitalHero, learnpro: LearningHero,
};

function FamilyCatalog({ data, family }: { data: Home; family: FamilyThemeId }) {
  const { locale, preview, filters } = data;
  const t = themeCopy[locale];
  const path = storePath(data);
  const title = family === "learnpro" ? familyLabels[locale][family].browse : t.products;
  return <section id="theme-products" className="store-section family-catalog" aria-labelledby="family-catalog-title">
    <h2 id="family-catalog-title">{title}</h2>
    {!preview && <CatalogFilter path={path} locale={locale} filters={filters} categories={data.categories.map((category) => ({
      value: category.slug, name: localizedValue(locale, category.nameAr, category.nameEn),
    }))} />}
    {data.products.length ? <ul className="store-product-grid">{data.products.map((product) => <ProductTile key={product.slug} base={data} product={product} />)}</ul>
      : <div className="store-empty"><p>{preview ? t.noProducts : catalogCopy[locale].noResults}</p>{!preview && <Link href={path}>{t.reset}</Link>}</div>}
    {!preview && <Pagination path={path} locale={locale} filters={filters} hasNext={data.hasNext} />}
  </section>;
}

function FamilyEditorial({ data, family, products }: { data: Home; family: FamilyThemeId; products: ThemeProduct[] }) {
  const { heading, body } = familyContent(data, family);
  const mosaic = family === "maison-wear" || family === "luma-gifts";
  const image = products.find((product) => productSource(data, product));
  if (!heading && !body && !(mosaic && image)) return null;
  return <section className="store-section family-editorial" id="theme-editorial" aria-labelledby="family-editorial-title">
    <div className="family-editorial-copy"><h2 id="family-editorial-title" dir="auto">{heading || familyLabels[data.locale][family].editorial}</h2>
      {body && <p dir="auto">{body}</p>}
    </div>
    {mosaic ? <MediaTiles data={data} products={products} className="family-lookbook" />
      : image && <Picture source={productSource(data, image)} alt="" />}
  </section>;
}

function Comparison({ data, products }: { data: Home; products: ThemeProduct[] }) {
  if (products.length < 2) return null;
  const t = catalogCopy[data.locale];
  return <section className="store-section family-comparison" id="theme-comparison">
    <h2>{themeCopy[data.locale].comparison}</h2>
    <table><thead><tr><th scope="col">{t.products}</th><th scope="col">{t.price}</th><th scope="col">{t.status}</th></tr></thead>
      <tbody>{products.slice(0, 4).map((product) => <tr key={product.slug}>
        <th scope="row"><bdi>{localizedValue(data.locale, product.nameAr, product.nameEn)}</bdi></th>
        <td><StorePrice base={data} product={product} /></td><td>{product.available ? t.available : t.unavailableItem}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

export async function FamilyHome({ data, family }: { data: Home; family: FamilyThemeId }) {
  const { design, locale, store, preview, filters } = data;
  const filtered = Boolean(filters.q || filters.category || filters.availableOnly || filters.page > 1 || filters.sort !== "featured");
  const highlights = await data.highlights;
  const featured = highlights.products.length ? highlights.products : data.products.filter((item) => item.featured).slice(0, 4);
  const featuredOrCatalog = featured.length ? featured : data.products.slice(0, 4);
  const media = [...featuredOrCatalog, ...data.products.filter((product) => !featuredOrCatalog.some((item) => item.slug === product.slug))];
  const pictured = media.find((product) => productSource(data, product));
  const source = data.demo?.banner ?? (design.assets.banner ? designAssetPath(store.slug, design.assets.banner, preview) : pictured ? productSource(data, pictured) : null);
  const Hero = heroes[family];
  const labels = familyLabels[locale][family];
  const categories = highlights.categories.length ? highlights.categories : data.categories.slice(0, 8);
  const discounted = featuredOrCatalog.filter((item) => item.available && item.compareAtMinor !== null && item.compareAtMinor > item.priceMinor);
  const picks = family === "electro-x" && discounted.length ? discounted : family === "digital-hub" ? featuredOrCatalog : featured;
  const sections = design.sections.filter((section) => section.visible && (!filtered || section.id === "products"));

  return <FamilyChrome base={data} family={family}>
    <main id="theme-main" className="store-width family-home">
      {!sections.some((section) => section.id === "hero") && <h1 className="family-page-title" dir="auto">{store.name}</h1>}
      {sections.map(({ id }) => {
        switch (id) {
          case "hero": return <Hero key={id} data={data} family={family} source={source} products={media.filter((item) => productSource(data, item) !== source)} />;
          case "products": return <FamilyCatalog key={id} data={data} family={family} />;
          case "categories": return categories.length > 0 && <section key={id} className="store-section family-categories" id="theme-categories">
            <h2>{labels.categories}</h2><CategoryShowcase base={data} items={categories} />
          </section>;
          case "featured": return picks.length > 0 && <section key={id} className="store-section family-picks" id="theme-featured">
            <h2 data-deals={family === "electro-x" && discounted.length > 0}>{family === "electro-x" && discounted.length ? (locale === "ar" ? "عروض متاحة" : "Current offers") : labels.featured}</h2>
            <ul className="store-product-grid">{picks.map((product) => <ProductTile key={product.slug} base={data} product={product} />)}</ul>
          </section>;
          case "comparison": return <Comparison key={id} data={data} products={featuredOrCatalog} />;
          case "editorial": return <FamilyEditorial key={id} data={data} family={family} products={media} />;
        }
      })}
    </main>
  </FamilyChrome>;
}

function FamilyGallery({ data, name }: { data: Detail; name: string }) {
  const { product, locale } = data;
  const images = product.images.slice(0, 5);
  return <div className="family-detail-media" data-multiple={images.length > 1}>
    <Picture source={images[0] ? mediaPath(data, images[0]) : null} alt={name} eager />
    {images.length > 1 && <ul>{images.slice(1).map((id, index) => <li key={id}>
      <Picture source={mediaPath(data, id)} alt={`${name} · ${catalogCopy[locale].image} ${index + 2}`} />
    </li>)}</ul>}
  </div>;
}

export function FamilyProduct({ data, family }: { data: Detail; family: FamilyThemeId }) {
  const { product, locale } = data;
  const name = localizedValue(locale, product.nameAr, product.nameEn);
  const description = localizedValue(locale, product.descriptionAr ?? "", product.descriptionEn);
  const learning = family === "learnpro";
  const lowerDescription = family !== "maison-wear" && family !== "luma-gifts";
  return <FamilyChrome base={data} family={family} product={product.slug}>
    <main id="theme-main" className="store-width family-product">
      <Link className="store-back" href={storePath(data)}>{themeCopy[locale].back}</Link>
      <div className="family-detail">
        <div className="family-detail-cover">
          <FamilyGallery data={data} name={name} />
          {learning && <h1 dir="auto">{name}</h1>}
        </div>
        <div className="family-detail-buy">
          {learning && <h2>{locale === "ar" ? "خيارات طلب الدورة" : "Course request options"}</h2>}
          <Details data={data} name={name} showHeading={!learning} showDescription={!lowerDescription} />
        </div>
      </div>
      {lowerDescription && description && <section className="store-section family-detail-notes">
        <h2>{familyLabels[locale][family].detail}</h2><p dir="auto">{description}</p>
      </section>}
    </main>
  </FamilyChrome>;
}

const cartIcons = { "aura-beauty": Sparkles, "luma-gifts": Gift, "digital-hub": Layers3, learnpro: BookOpen } as const;

export function FamilyCart({ base, family, children }: { base: Base; family: FamilyThemeId; children: ReactNode }) {
  const { locale } = base;
  const Icon = family === "electro-x" || family === "maison-wear" ? null : cartIcons[family];
  return <FamilyChrome base={base} family={family} cart>
    <main id="theme-main" className="store-width family-cart">
      <header className="family-cart-heading">
        <Link className="store-back" href={storePath(base)}>{orderCopy[locale].browse}</Link>
        <h1>{Icon && <Icon size={25} aria-hidden="true" />}{familyLabels[locale][family].cart}</h1>
      </header>
      <div className="family-cart-content">{children}</div>
    </main>
  </FamilyChrome>;
}
