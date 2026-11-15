import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { cache } from "react";
import { storeSlug } from "@/lib/validation";
import type { CatalogCard, PublicCategory } from "@/server/catalog/public";
import { categories, images, products } from "@/server/db/catalog-schema";
import { database } from "@/server/db/client";
import { withMerchantStore } from "@/server/stores/repository";
import { defaultDesign, themeConfig, type ThemeConfig } from "@/lib/theme-config";
import { readDesign } from "./design";

export type ThemeProduct = CatalogCard & { imageSrc?: string | null };
export type ThemeCategory = PublicCategory & { imageSrc?: string | null };
export type Highlights = { products: ThemeProduct[]; categories: ThemeCategory[] };

export const getPublishedDesign = cache(async (slug: string) => {
  if (!storeSlug.safeParse(slug).success) return defaultDesign();
  const { rows: [row] } = await (await database()).execute<{ design: unknown }>(sql`select public.theme_public_design(${slug}) as design`);
  const config = themeConfig.safeParse(row?.design);
  return config.success ? config.data : defaultDesign();
});

export async function getPublishedDesignAsset(slug: string, id: string) {
  const { rows: [row] } = await (await database()).execute<{ key: string | null }>(sql`select public.theme_public_asset(${slug}, ${id}) as key`);
  return row?.key ?? null;
}

export async function getThemeHighlights(slug: string, config: ThemeConfig) {
  const uuidArray = (values: string[]) => sql`ARRAY[${sql.join(values.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
  const { rows: [row] } = await (await database()).execute<Highlights>(sql`
    select products, categories from public.theme_public_highlights(${slug}, ${uuidArray(config.products)}, ${uuidArray(config.categories)})
  `);
  return row ?? { products: [], categories: [] };
}

export function getDesignPreview(userId: string, slug: string) {
  return withMerchantStore(userId, slug, false, async (tx, store) => {
    const design = await readDesign(tx, store.id);
    const config = design?.draft ?? defaultDesign();
    const productFields = {
      id: products.id, slug: products.slug, nameAr: products.nameAr, nameEn: products.nameEn, featured: products.featured,
      priceMinor: products.priceMinor, compareAtMinor: products.compareAtMinor, available: products.available, imageId: images.id,
    };
    const catalog = (selected: string[] | null) => tx.select(productFields).from(products)
      .leftJoin(images, and(eq(images.storeId, products.storeId), eq(images.productId, products.id), eq(images.primary, true)))
      .where(and(eq(products.storeId, store.id), eq(products.state, "published"),
        selected ? (selected.length ? inArray(products.id, selected) : eq(products.featured, true)) : undefined,
      )).orderBy(desc(products.featured), products.position, products.id).limit(selected ? 8 : 12);
    const productRows = await catalog(null);
    const featured = await catalog(config.products);
    if (config.products.length) featured.sort((a, b) => config.products.indexOf(a.id) - config.products.indexOf(b.id));
    const categoryRows = await tx.select({ id: categories.id, slug: categories.slug, nameAr: categories.nameAr, nameEn: categories.nameEn, imageId: images.id })
      .from(categories).leftJoin(images, and(eq(images.storeId, categories.storeId), eq(images.categoryId, categories.id), eq(images.state, "ready")))
      .where(and(eq(categories.storeId, store.id), eq(categories.visible, true))).orderBy(categories.position, categories.id);
    const showcase = config.categories.length ? config.categories.flatMap((id) => categoryRows.filter((category) => category.id === id)) : categoryRows.slice(0, 8);
    const image = <T extends { id: string; imageId: string | null }>(row: T, kind: "category" | "product") => ({
      ...row, imageSrc: row.imageId ? `/api/catalog/${slug}/${kind}/${row.id}/${row.imageId}` : null,
    });
    return { store, config, products: productRows.map((row) => image(row, "product")), categories: categoryRows.map((row) => image(row, "category")),
      highlights: { products: featured.map((row) => image(row, "product")), categories: showcase.map((row) => image(row, "category")) } };
  });
}
