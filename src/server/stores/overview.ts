import "server-only";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { categories, products } from "@/server/db/catalog-schema";
import { orderIntents } from "@/server/db/order-schema";
import { withMerchantStore } from "@/server/stores/repository";

export function readStoreOverview(userId: string, slug: string) {
  return withMerchantStore(userId, slug, false, async (tx, store) => {
    const [{ total: publishedProducts }] = await tx.select({ total: count() }).from(products)
      .where(and(eq(products.storeId, store.id), eq(products.state, "published")));
    const [{ total: categoryCount }] = await tx.select({ total: count() }).from(categories)
      .where(eq(categories.storeId, store.id));
    const [{ total: orderCount, confirmed }] = await tx.select({
      total: count(), confirmed: sql<number>`count(*) filter (where ${orderIntents.status} = 'merchant_confirmed')`.mapWith(Number),
    }).from(orderIntents).where(and(eq(orderIntents.storeId, store.id), isNull(orderIntents.archivedAt)));
    const recentOrders = await tx.select({
      reference: orderIntents.reference, channel: orderIntents.channel, status: orderIntents.status,
      currency: orderIntents.currency, total: orderIntents.total,
    }).from(orderIntents).where(and(eq(orderIntents.storeId, store.id), isNull(orderIntents.archivedAt)))
      .orderBy(desc(orderIntents.createdAt), orderIntents.id).limit(4);
    return { store, publishedProducts, categoryCount, orderCount, confirmed, recentOrders };
  });
}
