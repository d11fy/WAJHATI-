import "server-only";
import { randomUUID } from "node:crypto";
import { and, count, eq, sql } from "drizzle-orm";
import { type AssetKind } from "@/lib/theme-config";
import { storeDesignAssets } from "@/server/db/theme-schema";
import { withMerchantStore } from "@/server/stores/repository";
import { readDesign } from "./design";

type Reservation = { id: string; objectKey: string } | { error: "limit" };

export function reserveDesignAsset(user: string, slug: string, kind: AssetKind) {
  return withMerchantStore<Reservation>(user, slug, true, async (tx, store) => {
    const [{ total }] = await tx.select({ total: count() }).from(storeDesignAssets).where(eq(storeDesignAssets.storeId, store.id));
    if (total >= 12) return { error: "limit" };
    const id = randomUUID();
    const objectKey = `${store.id}/theme/${id}.webp`;
    await tx.insert(storeDesignAssets).values({ id, storeId: store.id, kind, objectKey });
    return { id, objectKey };
  });
}

export function finalizeDesignAsset(user: string, slug: string, id: string) {
  return withMerchantStore(user, slug, true, async (tx, store) => {
    const [asset] = await tx.update(storeDesignAssets).set({ state: "ready" }).where(and(
      eq(storeDesignAssets.storeId, store.id), eq(storeDesignAssets.id, id), eq(storeDesignAssets.state, "pending"),
      sql`${storeDesignAssets.createdAt} > now() - interval '10 minutes'`,
    )).returning({ id: storeDesignAssets.id });
    return asset ?? null;
  });
}

export function readDesignAsset(user: string, slug: string, id: string) {
  return withMerchantStore(user, slug, false, async (tx, store) => {
    const [asset] = await tx.select({ key: storeDesignAssets.objectKey }).from(storeDesignAssets).where(and(
      eq(storeDesignAssets.storeId, store.id), eq(storeDesignAssets.id, id), eq(storeDesignAssets.state, "ready"),
    ));
    return asset?.key ?? null;
  });
}

export function removeDesignAsset(user: string, slug: string, id: string, pendingOnly = false) {
  return withMerchantStore<{ id: string } | { error: "assetInUse" } | null>(user, slug, true, async (tx, store) => {
    const scope = and(eq(storeDesignAssets.storeId, store.id), eq(storeDesignAssets.id, id));
    const [asset] = await tx.select({ kind: storeDesignAssets.kind }).from(storeDesignAssets).where(scope);
    if (!asset) return null;
    const design = await readDesign(tx, store.id);
    if ([design?.draft, design?.published, design?.previousPublished].some((snapshot) => snapshot?.assets[asset.kind] === id)) {
      return { error: "assetInUse" };
    }
    const [removed] = await tx.delete(storeDesignAssets).where(and(scope, pendingOnly ? eq(storeDesignAssets.state, "pending") : undefined))
      .returning({ id: storeDesignAssets.id });
    return removed ?? null;
  });
}
