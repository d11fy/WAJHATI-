import "server-only";
import { sql } from "drizzle-orm";
import { catalogId, maxPage, pageSize, searchPattern, type CatalogFilters, type Currency, type OptionGroup } from "@/lib/catalog";
import { storeSlug } from "@/lib/validation";
import { database } from "@/server/db/client";
import { getPublicStore } from "@/server/stores/repository";

export type CatalogCard = {
  slug: string; nameAr: string; nameEn: string | null; priceMinor: number; compareAtMinor: number | null;
  featured: boolean; available: boolean; imageId: string | null;
};
export type PublicCategory = Pick<CatalogCard, "slug" | "nameAr" | "nameEn" | "imageId">;
export type ProductDetail = Omit<CatalogCard, "imageId"> & {
  descriptionAr: string | null; descriptionEn: string | null; images: string[]; options: OptionGroup[];
  storeName: string; country: string; currency: Currency;
};

export async function getPublicCatalog(slug: string, filters: CatalogFilters) {
  if (!storeSlug.safeParse(slug).success) return null;
  return (await database()).transaction(async (tx) => {
    const store = await getPublicStore(slug, tx);
    if (!store) return null;
    const categories = await tx.execute<PublicCategory>(sql`select slug, name_ar as "nameAr", name_en as "nameEn", image_id as "imageId"
      from public.catalog_public_categories(${slug})`);
    const products = await tx.execute<CatalogCard>(sql`select slug, name_ar as "nameAr", name_en as "nameEn", price_minor as "priceMinor",
      compare_at_minor as "compareAtMinor", featured, available, image_id as "imageId"
      from public.catalog_public_products(${slug}, ${searchPattern(filters.q)}, ${filters.category || null}, ${filters.sort},
        ${filters.availableOnly}, ${(filters.page - 1) * pageSize}, ${pageSize + 1})`);
    return { store, categories: categories.rows, products: products.rows.slice(0, pageSize), hasNext: filters.page < maxPage && products.rows.length > pageSize };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getPublicProduct(store: string, slug: string) {
  if (!storeSlug.safeParse(store).success || !storeSlug.safeParse(slug).success) return null;
  const { rows } = await (await database()).execute<ProductDetail>(sql`
    select p.slug, p.name_ar as "nameAr", p.name_en as "nameEn", p.description_ar as "descriptionAr", p.description_en as "descriptionEn",
      p.price_minor as "priceMinor", p.compare_at_minor as "compareAtMinor", p.featured, p.available, p.images, p.options,
      s.name as "storeName", s.country, s.currency
    from public.catalog_public_product(${store}, ${slug}) as p cross join public.get_public_store(${store}) as s
  `);
  return rows[0] ?? null;
}

export async function getPublicImage(store: string, id: string) {
  if (!storeSlug.safeParse(store).success || !catalogId.safeParse(id).success) return null;
  const { rows } = await (await database()).execute<{ objectKey: string }>(sql`
    select object_key as "objectKey" from public.catalog_public_image(${store}, ${id})
  `);
  return rows[0]?.objectKey ?? null;
}
