import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { catalogId, type MediaKind } from "@/lib/catalog";
import type { Transaction } from "@/server/db/actor";
import { categories, images, products } from "@/server/db/catalog-schema";
import { withMerchantStore } from "@/server/stores/repository";
import { limitsForStore } from "./limits";

export type MediaTarget = { userId: string; store: string; kind: MediaKind; target: string };
export type MediaOperation = "primary" | "up" | "down";
type ImageReservation = { id: string; objectKey: string } | { error: "limit" };

function targetFilter(storeId: string, { kind, target }: MediaTarget) {
  return and(eq(images.storeId, storeId), eq(kind === "product" ? images.productId : images.categoryId, target));
}

async function canUpload(tx: Transaction, storeId: string, { kind, target }: MediaTarget) {
  const table = kind === "product" ? products : categories;
  const [found] = await tx.select({ id: table.id }).from(table).where(and(eq(table.storeId, storeId), eq(table.id, target)));
  return Boolean(found);
}

export function checkImageTarget(target: MediaTarget) {
  if (!catalogId.safeParse(target.target).success) return Promise.resolve(null);
  return withMerchantStore(target.userId, target.store, false, (tx, store) => canUpload(tx, store.id, target));
}

export function reserveImage(target: MediaTarget) {
  if (!catalogId.safeParse(target.target).success) return Promise.resolve(null);
  return withMerchantStore<ImageReservation | null>(target.userId, target.store, true, async (tx, store) => {
    if (!await canUpload(tx, store.id, target)) return null;
    const rows = await tx.select({ position: images.position }).from(images).where(targetFilter(store.id, target)).orderBy(desc(images.position));
    const limits = await limitsForStore(store.id);
    if (rows.length >= (target.kind === "product" ? limits.imagesPerProduct : limits.imagesPerCategory)) return { error: "limit" as const };
    const id = randomUUID();
    const objectKey = `${store.id}/catalog/${id}.webp`;
    await tx.insert(images).values({
      id, objectKey, storeId: store.id, position: (rows[0]?.position ?? -1) + 1,
      productId: target.kind === "product" ? target.target : null, categoryId: target.kind === "category" ? target.target : null,
    });
    return { id, objectKey };
  });
}

export function finalizeImage(target: MediaTarget, id: string) {
  return withMerchantStore(target.userId, target.store, true, async (tx, store) => {
    const scope = targetFilter(store.id, target);
    const [primary] = await tx.select({ id: images.id }).from(images).where(and(scope, eq(images.primary, true)));
    const [updated] = await tx.update(images).set({ state: "ready", primary: target.kind === "product" && !primary })
      .where(and(scope, eq(images.id, id), eq(images.state, "pending"), sql`${images.createdAt} > now() - interval '10 minutes'`))
      .returning({ id: images.id });
    return updated ?? null;
  });
}

export function readMerchantImage(target: MediaTarget, id: string) {
  return withMerchantStore(target.userId, target.store, false, async (tx, store) => {
    const [image] = await tx.select({ objectKey: images.objectKey }).from(images)
      .where(and(targetFilter(store.id, target), eq(images.id, id), eq(images.state, "ready")));
    return image?.objectKey ?? null;
  });
}

export function removeImage(target: MediaTarget, id: string, pendingOnly = false) {
  return withMerchantStore(target.userId, target.store, true, async (tx, store) => {
    const scope = targetFilter(store.id, target);
    const [removed] = await tx.delete(images).where(and(scope, eq(images.id, id), pendingOnly ? eq(images.state, "pending") : undefined))
      .returning({ primary: images.primary });
    if (!removed) return null;
    if (removed.primary) {
      const [first] = await tx.select({ id: images.id }).from(images).where(and(scope, eq(images.state, "ready")))
        .orderBy(images.position, images.id).limit(1);
      if (first) await tx.update(images).set({ primary: true }).where(and(scope, eq(images.id, first.id)));
    }
    return true;
  });
}

export function updateImage(target: MediaTarget, id: string, operation: MediaOperation) {
  if (target.kind !== "product") return Promise.resolve(null);
  return withMerchantStore(target.userId, target.store, true, async (tx, store) => {
    const scope = and(targetFilter(store.id, target), eq(images.state, "ready"));
    const rows = await tx.select({ id: images.id, position: images.position, primary: images.primary }).from(images)
      .where(scope).orderBy(asc(images.position), asc(images.id));
    const index = rows.findIndex((image) => image.id === id);
    if (index < 0) return null;
    if (operation === "primary") {
      if (rows[index].primary) return true;
      await tx.update(images).set({ primary: false }).where(and(scope, eq(images.primary, true)));
      await tx.update(images).set({ primary: true }).where(and(scope, eq(images.id, id)));
    } else {
      const neighbor = rows[index + (operation === "up" ? -1 : 1)];
      if (neighbor) {
        await tx.update(images).set({ position: neighbor.position }).where(and(scope, eq(images.id, id)));
        await tx.update(images).set({ position: rows[index].position }).where(and(scope, eq(images.id, neighbor.id)));
      }
    }
    return true;
  });
}
