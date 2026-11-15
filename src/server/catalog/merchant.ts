import "server-only";
import { and, asc, count, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { catalogId, maxPage, pageSize, parseOptions, searchPattern, validatePrices, type CatalogFilters, type CategoryInput, type ProductInput } from "@/lib/catalog";
import type { Transaction } from "@/server/db/actor";
import { categories, images, productCategories, productOptions, products } from "@/server/db/catalog-schema";
import { hasDatabaseConstraint, isUniqueViolation } from "@/server/db/client";
import { withMerchantStore } from "@/server/stores/repository";
import { limitsForStore } from "./limits";

export type CatalogError = "slugTaken" | "categoryLinked" | "categoryInvalid" | "invalidPrices" | "invalidOptions" | "limit" | "emptyStore" | "billingPublication";

const categoryFields = {
  id: categories.id, nameAr: categories.nameAr, nameEn: categories.nameEn,
  slug: categories.slug, visible: categories.visible, position: categories.position, imageId: images.id,
};

function merchantCategories(tx: Transaction, storeId: string) {
  return tx.select(categoryFields).from(categories).leftJoin(images, and(
    eq(images.storeId, categories.storeId), eq(images.categoryId, categories.id), eq(images.state, "ready"),
  )).where(eq(categories.storeId, storeId)).orderBy(categories.position, categories.id);
}

export function listCategories(userId: string, storeSlug: string) {
  return withMerchantStore(userId, storeSlug, false, async (tx, store) => ({ store, categories: await merchantCategories(tx, store.id) }));
}

export async function saveCategory(userId: string, storeSlug: string, id: string | null, input: CategoryInput) {
  if (id && !catalogId.safeParse(id).success) return null;
  try {
    return await withMerchantStore(userId, storeSlug, true, async (tx, store) => {
      if (id) {
        const [updated] = await tx.update(categories).set(input)
          .where(and(eq(categories.storeId, store.id), eq(categories.id, id))).returning({ id: categories.id });
        return updated ?? null;
      }
      const [{ total }] = await tx.select({ total: count() }).from(categories).where(eq(categories.storeId, store.id));
      if (total >= (await limitsForStore(store.id)).categories) return { error: "limit" as const };
      const [created] = await tx.insert(categories).values({ ...input, storeId: store.id }).returning({ id: categories.id });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error, "catalog_categories_store_slug")) return { error: "slugTaken" as const };
    throw error;
  }
}

export async function deleteCategory(userId: string, storeSlug: string, id: string) {
  if (!catalogId.safeParse(id).success) return null;
  try {
    return await withMerchantStore(userId, storeSlug, true, async (tx, store) => {
      const [removed] = await tx.delete(categories).where(and(eq(categories.storeId, store.id), eq(categories.id, id)))
        .returning({ id: categories.id });
      return removed ?? null;
    });
  } catch (error) {
    if (hasDatabaseConstraint(error, "23001", "catalog_links_category") ||
        hasDatabaseConstraint(error, "23503", "catalog_links_category")) return { error: "categoryLinked" as const };
    throw error;
  }
}

function sortProducts(sort: CatalogFilters["sort"]) {
  const fallback = [desc(products.featured), asc(products.position), asc(products.id)];
  if (sort === "price-asc") return [asc(products.priceMinor), ...fallback];
  if (sort === "price-desc") return [desc(products.priceMinor), ...fallback];
  if (sort === "newest") return [desc(products.createdAt), ...fallback];
  return fallback;
}

export function listProducts(userId: string, storeSlug: string, filters: CatalogFilters) {
  return withMerchantStore(userId, storeSlug, false, async (tx, store) => {
    const pattern = searchPattern(filters.q);
    const rows = await tx.select({
      id: products.id, slug: products.slug, nameAr: products.nameAr, nameEn: products.nameEn,
      priceMinor: products.priceMinor, state: products.state, available: products.available, featured: products.featured, imageId: images.id,
    }).from(products).leftJoin(images, and(eq(images.storeId, products.storeId), eq(images.productId, products.id), eq(images.primary, true)))
      .where(and(
        eq(products.storeId, store.id), filters.state ? eq(products.state, filters.state) : undefined,
        filters.availableOnly ? eq(products.available, true) : undefined,
        pattern ? or(sql`${products.nameAr} ilike ${pattern}`, sql`${products.nameEn} ilike ${pattern}`, sql`${products.sku} ilike ${pattern}`) : undefined,
        filters.category ? exists(tx.select({ categoryId: productCategories.categoryId }).from(productCategories).where(and(
          eq(productCategories.storeId, store.id), eq(productCategories.productId, products.id), eq(productCategories.categoryId, filters.category),
        ))) : undefined,
      )).orderBy(...sortProducts(filters.sort)).offset((filters.page - 1) * pageSize).limit(pageSize + 1);
    return {
      store, categories: await merchantCategories(tx, store.id), products: rows.slice(0, pageSize),
      hasNext: filters.page < maxPage && rows.length > pageSize,
    };
  });
}

export function getProductForEdit(userId: string, storeSlug: string, id: string) {
  if (!catalogId.safeParse(id).success) return Promise.resolve(null);
  return withMerchantStore(userId, storeSlug, false, async (tx, store) => {
    const [product] = await tx.select().from(products).where(and(eq(products.storeId, store.id), eq(products.id, id)));
    if (!product) return null;
    const imageRows = await tx.select({ id: images.id, primary: images.primary }).from(images)
      .where(and(eq(images.storeId, store.id), eq(images.productId, id), eq(images.state, "ready")))
      .orderBy(images.position, images.id);
    const links = await tx.select({ id: productCategories.categoryId }).from(productCategories)
      .where(and(eq(productCategories.storeId, store.id), eq(productCategories.productId, id)));
    const options = await tx.select().from(productOptions)
      .where(and(eq(productOptions.storeId, store.id), eq(productOptions.productId, id)))
      .orderBy(productOptions.groupPosition, productOptions.position);
    const optionGroups = new Map<string, string[]>();
    for (const option of options) {
      const values = optionGroups.get(option.groupName) ?? [];
      values.push(option.value);
      optionGroups.set(option.groupName, values);
    }
    return {
      store, product, imageRows, categories: await merchantCategories(tx, store.id), categoryIds: links.map((link) => link.id),
      options: Array.from(optionGroups, ([name, values]) => `${name}: ${values.join(", ")}`).join("\n"),
    };
  });
}

export async function saveProduct(userId: string, storeSlug: string, id: string | null, input: ProductInput) {
  if (id && !catalogId.safeParse(id).success) return null;
  try {
    return await withMerchantStore(userId, storeSlug, true, async (tx, store) => {
      const { price, compareAt, categoryIds, options, ...product } = input;
      const prices = validatePrices(price, compareAt, store.currency);
      if (!prices) return { error: "invalidPrices" as const };
      const groups = parseOptions(options);
      if (!groups) return { error: "invalidOptions" as const };
      if (categoryIds.length) {
        const found = await tx.select({ id: categories.id }).from(categories)
          .where(and(eq(categories.storeId, store.id), inArray(categories.id, categoryIds)));
        if (found.length !== categoryIds.length) return { error: "categoryInvalid" as const };
      }

      const values = { ...product, ...prices };
      const [saved] = id
        ? await tx.update(products).set(values).where(and(eq(products.storeId, store.id), eq(products.id, id))).returning({ id: products.id })
        : await tx.insert(products).values({ ...values, storeId: store.id }).returning({ id: products.id });
      if (!saved) return null;

      if (id) {
        await tx.delete(productCategories).where(and(eq(productCategories.storeId, store.id), eq(productCategories.productId, id)));
        await tx.delete(productOptions).where(and(eq(productOptions.storeId, store.id), eq(productOptions.productId, id)));
      }
      if (categoryIds.length) await tx.insert(productCategories).values(categoryIds.map((categoryId) => ({ storeId: store.id, productId: saved.id, categoryId })));
      if (groups.length) await tx.insert(productOptions).values(groups.flatMap((group, groupPosition) => group.values.map((value, position) => ({
        storeId: store.id, productId: saved.id, groupName: group.name, groupPosition, position, value,
      }))));
      return saved;
    });
  } catch (error) {
    if (isUniqueViolation(error, "catalog_products_store_slug")) return { error: "slugTaken" as const };
    if (hasDatabaseConstraint(error, "23514", "billing_product_limit")) return { error: "limit" as const };
    if (hasDatabaseConstraint(error, "23514", "billing_publication")) return { error: "billingPublication" as const };
    throw error;
  }
}

export function archiveProduct(userId: string, storeSlug: string, id: string) {
  if (!catalogId.safeParse(id).success) return Promise.resolve(null);
  return withMerchantStore(userId, storeSlug, true, async (tx, store) => {
    const [updated] = await tx.update(products).set({ state: "archived" })
      .where(and(eq(products.storeId, store.id), eq(products.id, id))).returning({ id: products.id });
    return updated ?? null;
  });
}

export function setStorePublication(userId: string, storeSlug: string, published: boolean) {
  return withMerchantStore<{ id: string } | { error: "emptyStore" } | null>(userId, storeSlug, true, async (tx, store) => {
    if (store.role !== "owner") return null;
    const { rows: [row] } = await tx.execute<{ result: "empty" | "ok" | "denied" }>(sql`
      select public.catalog_set_store_publication(${store.id}, ${published}) as result
    `);
    return row.result === "empty" ? { error: "emptyStore" as const } : row.result === "ok" ? { id: store.id } : null;
  }).catch((error: unknown) => {
    if (hasDatabaseConstraint(error, "23514", "billing_publication")) return { error: "billingPublication" as const };
    throw error;
  });
}
