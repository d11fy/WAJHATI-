import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { channels, statuses, type CartLine, type Contact } from "../../lib/checkout";
import { currencyCode, stores } from "./schema";

export const orderChannel = pgEnum("order_channel", channels);
export const orderStatus = pgEnum("order_intent_status", statuses);
const storeId = () => uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" });
const timestampNow = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const orderSettings = pgTable("order_settings", {
  storeId: storeId().primaryKey(), config: jsonb().$type<Contact>().notNull(),
}, (t) => [check("order_settings_object", sql`jsonb_typeof(${t.config}) = 'object'`)]).enableRLS();

export const orderIntents = pgTable("order_intents", {
  storeId: storeId(), id: uuid().defaultRandom().notNull(), reference: varchar({ length: 23 }).notNull(),
  requestKey: varchar("request_key", { length: 64 }).notNull(), fingerprint: varchar({ length: 64 }).notNull(),
  channel: orderChannel().notNull(), status: orderStatus().notNull().default("initiated"),
  currency: currencyCode().notNull(), total: bigint({ mode: "number" }).notNull(),
  locale: varchar({ length: 2 }).notNull(), createdAt: timestampNow("created_at"), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.id] }), unique("order_intents_reference_unique").on(t.reference),
  unique("order_intents_request_unique").on(t.storeId, t.requestKey), index("order_intents_recent").on(t.storeId, t.createdAt.desc(), t.id),
  index("order_intents_status_recent").on(t.storeId, t.status, t.createdAt.desc()), index("order_intents_retention").on(t.status, t.createdAt),
  check("order_intents_format", sql`${t.reference} ~ '^DM-[0-9A-F]{20}$' and ${t.locale} in ('ar', 'en') and ${t.total} between 0 and 515396075280`),
]).enableRLS();

export const orderItems = pgTable("order_intent_items", {
  storeId: uuid("store_id").notNull(), intentId: uuid("intent_id").notNull(), position: integer().notNull(),
  product: varchar({ length: 48 }).notNull(), nameAr: varchar("name_ar", { length: 100 }).notNull(),
  nameEn: varchar("name_en", { length: 100 }), options: jsonb().$type<CartLine["options"]>().notNull(),
  quantity: integer().notNull(), unitMinor: integer("unit_minor").notNull(), imageId: uuid("image_id"),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.intentId, t.position] }),
  foreignKey({ name: "order_items_intent", columns: [t.storeId, t.intentId], foreignColumns: [orderIntents.storeId, orderIntents.id] }).onDelete("cascade"),
  check("order_items_bounds", sql`${t.position} between 1 and 12 and ${t.quantity} between 1 and 20 and ${t.unitMinor} >= 0 and jsonb_typeof(${t.options}) = 'array'`),
]).enableRLS();

export const orderEvents = pgTable("order_intent_events", {
  storeId: uuid("store_id").notNull(), intentId: uuid("intent_id").notNull(), type: text().notNull(), createdAt: timestampNow("created_at"),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.intentId, t.type] }),
  foreignKey({ name: "order_events_intent", columns: [t.storeId, t.intentId], foreignColumns: [orderIntents.storeId, orderIntents.id] }).onDelete("cascade"),
  check("order_events_type", sql`${t.type} = 'contact_opened'`),
]).enableRLS();
