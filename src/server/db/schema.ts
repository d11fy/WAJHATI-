import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, primaryKey, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { countries, currencies } from "../../lib/validation";

export const storeRole = pgEnum("store_role", ["owner", "staff"]);
export const countryCode = pgEnum("country_code", countries);
export const currencyCode = pgEnum("currency_code", currencies);

export const users = pgTable("users", {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 80 }).notNull(),
  email: varchar({ length: 254 }).notNull().unique("users_email_unique"),
  passwordHash: varchar("password_hash", { length: 160 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const stores = pgTable("stores", {
  id: uuid().defaultRandom().primaryKey(),
  name: varchar({ length: 80 }).notNull(),
  slug: varchar({ length: 48 }).notNull().unique("stores_slug_unique"),
  country: countryCode().notNull(),
  currency: currencyCode().notNull(),
  published: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  check("stores_slug_format", sql`length(${table.slug}) >= 3 and ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check("stores_name_length", sql`length(btrim(${table.name})) between 2 and 80`),
]).enableRLS();

export const storeMemberships = pgTable("store_memberships", {
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  role: storeRole().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.storeId, table.userId] }),
  index("store_memberships_user_idx").on(table.userId),
]).enableRLS();

export const sessions = pgTable("sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("sessions_expiry_idx").on(table.expiresAt), index("sessions_user_idx").on(table.userId)]).enableRLS();

export const authLimits = pgTable("auth_limits", {
  key: varchar({ length: 64 }).primaryKey(),
  attempts: integer().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("auth_limits_expiry_idx").on(table.expiresAt)]);
