import "server-only";
import { and, desc, eq, ilike, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { parsePhoneNumberFromString } from "libphonenumber-js/max";
import { contactInput, emptyContact, type Contact, type statuses } from "@/lib/checkout";
import { orderEvents, orderIntents, orderItems, orderSettings } from "@/server/db/order-schema";
import { withMerchantStore } from "@/server/stores/repository";

export function validateContact(value: unknown) {
  const result = contactInput.safeParse(value);
  if (!result.success) return null;
  if (result.data.phone && !parsePhoneNumberFromString(result.data.phone, { extract: false })?.isValid()) return null;
  return result.data;
}

export function getOrderSettings(user: string, slug: string) {
  return withMerchantStore(user, slug, false, async (tx, store) => {
    const [row] = await tx.select().from(orderSettings).where(eq(orderSettings.storeId, store.id));
    return { store, config: row?.config ?? emptyContact };
  });
}

export function saveOrderSettings(user: string, slug: string, config: Contact) {
  return withMerchantStore(user, slug, true, async (tx, store) => {
    if (store.role !== "owner") return null;
    await tx.insert(orderSettings).values({ storeId: store.id, config }).onConflictDoUpdate({ target: orderSettings.storeId, set: { config } });
    return true;
  });
}

const fields = {
  id: orderIntents.id, reference: orderIntents.reference, channel: orderIntents.channel, status: orderIntents.status,
  currency: orderIntents.currency, total: orderIntents.total, createdAt: orderIntents.createdAt, archivedAt: orderIntents.archivedAt,
};
type Status = typeof statuses[number];
export type OrderFilter = Status | "archived" | "active";

export function listOrders(user: string, slug: string, filter: OrderFilter, query: string, page: number) {
  return withMerchantStore(user, slug, false, async (tx, store) => {
    const rows = await tx.select(fields).from(orderIntents).where(and(eq(orderIntents.storeId, store.id),
      filter === "archived" ? isNotNull(orderIntents.archivedAt) : isNull(orderIntents.archivedAt),
      filter !== "active" && filter !== "archived" ? eq(orderIntents.status, filter) : undefined,
      query ? ilike(orderIntents.reference, `${query}%`) : undefined,
    )).orderBy(desc(orderIntents.createdAt), orderIntents.id).offset((page - 1) * 12).limit(13);
    const visible = rows.slice(0, 12);
    const items = visible.length ? await tx.select({ intentId: orderItems.intentId, nameAr: orderItems.nameAr, nameEn: orderItems.nameEn, quantity: orderItems.quantity })
      .from(orderItems).where(and(eq(orderItems.storeId, store.id), inArray(orderItems.intentId, visible.map((row) => row.id)))).orderBy(orderItems.position) : [];
    return { rows: visible.map((row) => ({ ...row, items: items.filter((item) => item.intentId === row.id) })), hasNext: rows.length > 12 };
  });
}

export function getOrder(user: string, slug: string, reference: string) {
  return withMerchantStore(user, slug, false, async (tx, store) => {
    const [order] = await tx.select(fields).from(orderIntents).where(and(eq(orderIntents.storeId, store.id), eq(orderIntents.reference, reference)));
    if (!order) return null;
    const lines = await tx.select().from(orderItems).where(and(eq(orderItems.storeId, store.id), eq(orderItems.intentId, order.id))).orderBy(orderItems.position);
    const [event] = await tx.select({ openedAt: orderEvents.createdAt }).from(orderEvents)
      .where(and(eq(orderEvents.storeId, store.id), eq(orderEvents.intentId, order.id)));
    return { ...order, lines, openedAt: event?.openedAt ?? null };
  });
}

export function changeOrder(user: string, slug: string, reference: string, action: "confirm" | "cancel" | "archive") {
  return withMerchantStore(user, slug, true, async (tx, store) => {
    const [updated] = await tx.update(orderIntents).set(action === "archive" ? { archivedAt: sql`now()` }
      : { status: action === "confirm" ? "merchant_confirmed" : "cancelled" })
      .where(and(eq(orderIntents.storeId, store.id), eq(orderIntents.reference, reference), isNull(orderIntents.archivedAt),
        action !== "archive" ? inArray(orderIntents.status, ["initiated", "contact_opened"]) : undefined))
      .returning({ reference: orderIntents.reference });
    return updated ?? null;
  });
}
