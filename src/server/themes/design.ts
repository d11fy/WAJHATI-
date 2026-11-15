import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { defaultDesign, designAssetKinds, isFamilyTheme, themeConfig, type ThemeConfig } from "@/lib/theme-config";
import { entitledThemes, entitlements } from "@/server/billing/entitlements";
import type { Transaction } from "@/server/db/actor";
import { categories, products } from "@/server/db/catalog-schema";
import { storeDesignAssets, storeDesigns } from "@/server/db/theme-schema";
import { withMerchantStore } from "@/server/stores/repository";

export type DesignError = "invalid" | "contrast" | "conflict" | "invalidReferences" | "unavailable" | "notEntitled" | "noPublished" | "noPrevious";

export async function readDesign(tx: Transaction, storeId: string) {
  const [design] = await tx.select().from(storeDesigns).where(eq(storeDesigns.storeId, storeId));
  return design;
}

export function getDesigner(userId: string, slug: string) {
  return withMerchantStore(userId, slug, false, async (tx, store) => {
    const design = await readDesign(tx, store.id);
    const available = await tx.select({ id: products.id, nameAr: products.nameAr, nameEn: products.nameEn }).from(products)
      .where(and(eq(products.storeId, store.id), eq(products.state, "published"))).orderBy(products.position, products.id);
    const visible = await tx.select({ id: categories.id, nameAr: categories.nameAr, nameEn: categories.nameEn }).from(categories)
      .where(and(eq(categories.storeId, store.id), eq(categories.visible, true))).orderBy(categories.position, categories.id);
    const assets = await tx.select({ id: storeDesignAssets.id, kind: storeDesignAssets.kind }).from(storeDesignAssets)
      .where(and(eq(storeDesignAssets.storeId, store.id), eq(storeDesignAssets.state, "ready")))
      .orderBy(desc(storeDesignAssets.createdAt), storeDesignAssets.id);
    const rights = await entitlements(tx, store.id);
    return {
      store, draft: design?.draft ?? defaultDesign(), revision: design?.revision ?? 0, publishedRevision: design?.publishedRevision ?? null,
      products: available, categories: visible, assets, allowed: entitledThemes(rights.luxury), premium: rights.premium,
      hasPrevious: Boolean(design?.previousPublished),
    };
  });
}

async function validReferences(tx: Transaction, storeId: string, config: ThemeConfig) {
  const chosenAssets = designAssetKinds.flatMap((kind) => config.assets[kind] ? [{ kind, id: config.assets[kind] }] : []);
  if (chosenAssets.length) {
    const rows = await tx.select({ id: storeDesignAssets.id, kind: storeDesignAssets.kind }).from(storeDesignAssets)
      .where(and(eq(storeDesignAssets.storeId, storeId), eq(storeDesignAssets.state, "ready"), inArray(storeDesignAssets.id, chosenAssets.map((asset) => asset.id))));
    if (!chosenAssets.every((chosen) => rows.some((row) => row.id === chosen.id && row.kind === chosen.kind))) return false;
  }
  if (config.products.length) {
    const rows = await tx.select({ id: products.id }).from(products).where(and(eq(products.storeId, storeId), inArray(products.id, config.products)));
    if (rows.length !== config.products.length) return false;
  }
  if (config.categories.length) {
    const rows = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.storeId, storeId), inArray(categories.id, config.categories)));
    if (rows.length !== config.categories.length) return false;
  }
  return true;
}

type Result = { revision: number } | { error: DesignError } | null;

function allowsStyle(config: ThemeConfig, rights: Awaited<ReturnType<typeof entitlements>>) {
  if (!entitledThemes(rights.luxury).includes(config.theme)) return false;
  if (rights.premium) return true;
  const basic = defaultDesign(isFamilyTheme(config.theme) ? config.theme : "minimal-commerce");
  return config.font === basic.font && Object.entries(basic.colors).every(([key, value]) => config.colors[key as keyof ThemeConfig["colors"]] === value);
}

export function saveDesign(userId: string, slug: string, revision: number, config: ThemeConfig) {
  return withMerchantStore<Result>(userId, slug, true, async (tx, store) => {
    const design = await readDesign(tx, store.id);
    if ((design?.revision ?? 0) !== revision) return { error: "conflict" };
    if (!allowsStyle(config, await entitlements(tx, store.id))) return { error: "notEntitled" };
    if (!await validReferences(tx, store.id, config)) return { error: "invalidReferences" };
    if (design) {
      await tx.update(storeDesigns).set({ draft: config, revision: revision + 1 }).where(eq(storeDesigns.storeId, store.id));
    } else {
      await tx.execute(sql`insert into public.store_designs (store_id, draft, revision) values (${store.id}, ${JSON.stringify(config)}::jsonb, 1)`);
    }
    return { revision: revision + 1 };
  });
}

export function publishDesign(userId: string, slug: string, revision: number) {
  return withMerchantStore<Result>(userId, slug, true, async (tx, store) => {
    if (store.role !== "owner") return null;
    const row = await readDesign(tx, store.id);
    if (!row || row.revision !== revision) return { error: "conflict" };
    const draft = themeConfig.safeParse(row.draft);
    if (!draft.success) return { error: "invalid" };
    const rights = await entitlements(tx, store.id);
    if (!rights.publish || !allowsStyle(draft.data, rights)) return { error: "notEntitled" };
    const { rows: [result] } = await tx.execute<{ status: "ok" | "denied" | "conflict" | "invalidReferences" }>(sql`
      select public.theme_publish(${store.id}, ${revision}) as status
    `);
    if (result.status === "denied") return null;
    return result.status === "ok" ? { revision } : { error: result.status };
  });
}

export function restorePublishedDesign(userId: string, slug: string, revision: number, previous = false) {
  return withMerchantStore<Result>(userId, slug, true, async (tx, store) => {
    if (previous && store.role !== "owner") return null;
    const row = await readDesign(tx, store.id);
    if (!row?.published) return { error: "noPublished" };
    if (row.revision !== revision) return { error: "conflict" };
    const snapshot = previous ? row.previousPublished : row.published;
    if (!snapshot) return { error: "noPrevious" };
    if (previous) {
      if (!allowsStyle(snapshot, await entitlements(tx, store.id))) return { error: "notEntitled" };
      if (!await validReferences(tx, store.id, snapshot)) return { error: "invalidReferences" };
    }
    await tx.update(storeDesigns).set({ draft: snapshot, revision: revision + 1 }).where(eq(storeDesigns.storeId, store.id));
    return { revision: revision + 1 };
  });
}
