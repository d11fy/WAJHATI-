import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { stores } from "./schema";

export const productState = pgEnum("catalog_product_state", ["draft", "published", "archived"]);
export const mediaState = pgEnum("catalog_media_state", ["pending", "ready"]);
const storeId = () => uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const categories = pgTable("catalog_categories", {
  storeId: storeId(),
  id: uuid().defaultRandom().notNull(),
  slug: varchar({ length: 48 }).notNull(),
  nameAr: varchar("name_ar", { length: 100 }).notNull(),
  nameEn: varchar("name_en", { length: 100 }),
  position: integer().notNull().default(0),
  visible: boolean().notNull().default(true),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.id] }),
  unique("catalog_categories_store_slug").on(t.storeId, t.slug),
  index("catalog_categories_order").on(t.storeId, t.position, t.id),
  check("catalog_categories_position", sql`${t.position} between 0 and 999999`),
  check("catalog_categories_slug", sql`length(${t.slug}) >= 3 and ${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]).enableRLS();

export const products = pgTable("catalog_products", {
  storeId: storeId(),
  id: uuid().defaultRandom().notNull(),
  slug: varchar({ length: 48 }).notNull(),
  nameAr: varchar("name_ar", { length: 100 }).notNull(),
  nameEn: varchar("name_en", { length: 100 }),
  descriptionAr: text("description_ar"),
  descriptionEn: text("description_en"),
  priceMinor: integer("price_minor").notNull(),
  compareAtMinor: integer("compare_at_minor"),
  sku: varchar({ length: 64 }),
  state: productState().notNull().default("draft"),
  position: integer().notNull().default(0),
  featured: boolean().notNull().default(false),
  available: boolean().notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.id] }),
  unique("catalog_products_store_slug").on(t.storeId, t.slug),
  index("catalog_products_visibility_order").on(t.storeId, t.state, t.featured.desc(), t.position, t.id),
  index("catalog_products_order").on(t.storeId, t.position, t.id),
  check("catalog_products_price", sql`${t.priceMinor} >= 0 and (${t.compareAtMinor} is null or ${t.compareAtMinor} > ${t.priceMinor})`),
  check("catalog_products_position", sql`${t.position} between 0 and 999999`),
  check("catalog_products_slug", sql`length(${t.slug}) >= 3 and ${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]).enableRLS();

export const productCategories = pgTable("catalog_product_categories", {
  storeId: storeId(),
  productId: uuid("product_id").notNull(),
  categoryId: uuid("category_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.productId, t.categoryId] }),
  index("catalog_product_categories_category").on(t.storeId, t.categoryId),
  foreignKey({ name: "catalog_links_product", columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
  foreignKey({ name: "catalog_links_category", columns: [t.storeId, t.categoryId], foreignColumns: [categories.storeId, categories.id] }).onDelete("restrict"),
]).enableRLS();

export const productOptions = pgTable("catalog_product_options", {
  storeId: storeId(),
  productId: uuid("product_id").notNull(),
  groupPosition: integer("group_position").notNull(),
  position: integer().notNull(),
  groupName: varchar("group_name", { length: 40 }).notNull(),
  value: varchar({ length: 60 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.productId, t.groupPosition, t.position] }),
  foreignKey({ name: "catalog_options_product", columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
  check("catalog_options_position", sql`${t.groupPosition} between 0 and 7 and ${t.position} between 0 and 9`),
]).enableRLS();

export const images = pgTable("catalog_images", {
  storeId: storeId(),
  id: uuid().notNull(),
  productId: uuid("product_id"),
  categoryId: uuid("category_id"),
  objectKey: text("object_key").notNull(),
  state: mediaState().notNull().default("pending"),
  position: integer().notNull(),
  primary: boolean("is_primary").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.storeId, t.id] }),
  foreignKey({ name: "catalog_images_product", columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
  foreignKey({ name: "catalog_images_category", columns: [t.storeId, t.categoryId], foreignColumns: [categories.storeId, categories.id] }).onDelete("cascade"),
  check("catalog_images_parent", sql`num_nonnulls(${t.productId}, ${t.categoryId}) = 1`),
  check("catalog_images_key", sql`${t.objectKey} = ${t.storeId}::text || '/catalog/' || ${t.id}::text || '.webp'`),
  check("catalog_images_primary_ready", sql`not ${t.primary} or (${t.state} = 'ready' and ${t.productId} is not null)`),
  uniqueIndex("catalog_images_one_primary").on(t.storeId, t.productId).where(sql`${t.primary}`),
  uniqueIndex("catalog_images_one_category").on(t.storeId, t.categoryId).where(sql`${t.categoryId} is not null`),
  index("catalog_images_product_order").on(t.storeId, t.productId, t.position, t.id),
  index("catalog_images_pending").on(t.createdAt).where(sql`${t.state} = 'pending'`),
]).enableRLS();

export const mediaGc = pgTable("catalog_media_gc", {
  objectKey: text("object_key").primaryKey(),
  storeId: uuid("store_id").notNull(), // Keep cleanup work even when the store is deleted.
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
}, (t) => [index("catalog_media_gc_ready").on(t.availableAt)]).enableRLS();
