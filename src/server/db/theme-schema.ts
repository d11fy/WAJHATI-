import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { designAssetKinds, type ThemeConfig } from "../../lib/theme-config";
import { mediaState } from "./catalog-schema";
import { stores } from "./schema";

export const themeAssetKind = pgEnum("theme_asset_kind", designAssetKinds);

export const storeDesigns = pgTable("store_designs", {
  storeId: uuid("store_id").primaryKey().references(() => stores.id, { onDelete: "cascade" }),
  draft: jsonb().$type<ThemeConfig>().notNull(),
  revision: integer().notNull(),
  published: jsonb().$type<ThemeConfig>(),
  previousPublished: jsonb("previous_published").$type<ThemeConfig>(),
  publishedRevision: integer("published_revision"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (table) => [
  check("store_design_draft_object", sql`jsonb_typeof(${table.draft}) = 'object' and ${table.revision} > 0`),
  check("store_design_publication", sql`num_nonnulls(${table.published}, ${table.publishedRevision}, ${table.publishedAt}) in (0, 3)
    and (${table.published} is null or (jsonb_typeof(${table.published}) = 'object' and ${table.publishedRevision} between 1 and ${table.revision}))`),
  check("store_design_previous_object", sql`${table.previousPublished} is null
    or (${table.published} is not null and jsonb_typeof(${table.previousPublished}) = 'object')`),
]).enableRLS();

export const storeDesignAssets = pgTable("store_design_assets", {
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  id: uuid().notNull(),
  kind: themeAssetKind().notNull(),
  objectKey: text("object_key").notNull(),
  state: mediaState().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.id] }),
  index("store_design_assets_pending").on(table.createdAt).where(sql`${table.state} = 'pending'`),
  check("store_design_assets_key", sql`${table.objectKey} = ${table.storeId}::text || '/theme/' || ${table.id}::text || '.webp'`),
]).enableRLS();
