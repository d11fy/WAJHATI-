import { sql } from "drizzle-orm";
import { boolean, check, customType, foreignKey, index, integer, pgEnum, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { countryCode, currencyCode, stores, users } from "./schema";

export const billingInterval = pgEnum("billing_interval", ["monthly", "yearly"]);
export const paymentStatus = pgEnum("billing_payment_status", ["awaiting_payment", "submitted", "under_review", "approved", "rejected", "expired"]);
export const subscriptionStatus = pgEnum("billing_subscription_status", ["trialing", "active", "pending_payment", "grace_period", "suspended", "canceled", "expired"]);
const date = (name: string) => timestamp(name, { withTimezone: true });
const now = (name: string) => date(name).notNull().defaultNow();
const store = () => uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" });
const user = (name: string) => uuid(name).notNull().references(() => users.id, { onDelete: "restrict" });
const bytes = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const billingConfig = pgTable("billing_config", {
  id: integer().primaryKey().default(1), trialDays: integer("trial_days").notNull().default(7),
  graceDays: integer("grace_days").notNull().default(7), trialProducts: integer("trial_products").notNull().default(10),
}, (t) => [check("billing_config_bounds", sql`${t.id} = 1 AND ${t.trialDays} between 1 and 30 AND ${t.graceDays} between 0 and 30 AND ${t.trialProducts} between 1 and 30`)]).enableRLS();

export const billingPlans = pgTable("billing_plans", {
  id: uuid().defaultRandom().primaryKey(), code: text().notNull(), version: integer().notNull(), name: text().notNull(),
  maxProducts: integer("max_products").notNull(), storageMiB: integer("storage_mib").notNull(), analytics: text().notNull(),
  luxury: boolean().notNull(), premium: boolean().notNull(),
}, (t) => [unique("billing_plan_version").on(t.code, t.version),
  check("billing_plan_valid", sql`${t.code} in ('starter','pro') AND ${t.version} > 0 AND ${t.maxProducts} between 1 and 10000 AND ${t.storageMiB} between 6 and 1000000 AND ${t.analytics} in ('basic','enhanced')`)]).enableRLS();

export const billingPrices = pgTable("billing_prices", {
  id: uuid().defaultRandom().primaryKey(), planId: uuid("plan_id").notNull().references(() => billingPlans.id),
  country: countryCode().notNull(), currency: currencyCode().notNull(), interval: billingInterval().notNull(),
  amount: integer().notNull(), active: boolean().default(true).notNull(),
}, (t) => [uniqueIndex("billing_active_price").on(t.planId, t.country, t.currency, t.interval).where(sql`${t.active}`),
  check("billing_price_amount", sql`${t.amount} between 1 and 1000000000`)]).enableRLS();

export const billingMethods = pgTable("billing_methods", {
  id: uuid().defaultRandom().primaryKey(), country: countryCode().notNull(), currency: currencyCode().notNull(),
  label: text().notNull(), instructions: text().notNull(), active: boolean().default(true).notNull(),
}, (t) => [check("billing_method_text", sql`length(btrim(${t.label})) between 1 and 100 and length(btrim(${t.instructions})) between 1 and 1600`)]).enableRLS();

export const billingSetupPackages = pgTable("billing_setup_packages", {
  id: uuid().defaultRandom().primaryKey(), country: countryCode().notNull(), currency: currencyCode().notNull(),
  label: text().notNull(), amount: integer().notNull(), active: boolean().default(true).notNull(),
}, (t) => [check("billing_setup_amount", sql`${t.amount} between 1 and 1000000000 and length(btrim(${t.label})) between 1 and 100`)]).enableRLS();

export const billingAdmins = pgTable("billing_admins", {
  userId: user("user_id").primaryKey(), grantedAt: now("granted_at"),
}).enableRLS();

export const billingVerifiedAccounts = pgTable("billing_verified_accounts", {
  userId: user("user_id").primaryKey(), email: text().notNull().unique(), verifiedAt: now("verified_at"),
}).enableRLS();

export const billingSubscriptions = pgTable("billing_subscriptions", {
  storeId: store().primaryKey(), createdAt: now("created_at"), legacy: boolean().default(false).notNull(),
  cancelAt: date("cancel_at"), cancelRequestedAt: date("cancel_requested_at"),
  observedStatus: subscriptionStatus("observed_status"), observedAt: date("observed_at"),
}).enableRLS();

export const billingTrials = pgTable("billing_trials", {
  storeId: store().primaryKey(), userId: user("user_id").unique(), startsAt: now("starts_at"),
  endsAt: date("ends_at").notNull(), maxProducts: integer("max_products").notNull(),
}, (t) => [check("billing_trial_dates", sql`${t.endsAt} > ${t.startsAt} and ${t.maxProducts} between 1 and 30`)]).enableRLS();

export const billingRequests = pgTable("billing_requests", {
  id: uuid().defaultRandom().primaryKey(), storeId: store(), requestedBy: user("requested_by"),
  idempotencyKey: uuid("idempotency_key").notNull(), reference: text().notNull().unique(),
  priceId: uuid("price_id").notNull().references(() => billingPrices.id),
  planId: uuid("plan_id").notNull().references(() => billingPlans.id), interval: billingInterval().notNull(),
  country: countryCode().notNull(), currency: currencyCode().notNull(), planMinor: integer("plan_minor").notNull(),
  setupMinor: integer("setup_minor").default(0).notNull(),
  methodId: uuid("method_id").notNull().references(() => billingMethods.id), methodLabel: text("method_label").notNull(),
  instructions: text().notNull(), status: paymentStatus().default("awaiting_payment").notNull(),
  transactionRef: text("transaction_ref"), createdAt: now("created_at"), expiresAt: date("expires_at").notNull(),
  submittedAt: date("submitted_at"), reviewedAt: date("reviewed_at"),
}, (t) => [unique("billing_request_tenant").on(t.storeId, t.id),
  unique("billing_request_key").on(t.storeId, t.idempotencyKey),
  uniqueIndex("billing_one_open_request").on(t.storeId).where(sql`${t.status} in ('awaiting_payment','submitted','under_review')`),
  uniqueIndex("billing_verified_transfer_unique").on(t.methodId, sql`lower(${t.transactionRef})`).where(sql`${t.status} = 'approved'`),
  index("billing_request_queue").on(t.status, t.createdAt),
  check("billing_request_amount", sql`${t.planMinor} between 1 and 1000000000 and ${t.setupMinor} between 0 and 1000000000`),
  check("billing_request_dates", sql`${t.expiresAt} > ${t.createdAt}`),
  check("billing_request_reference", sql`${t.reference} ~ '^DAR-[A-F0-9]{20}$'`),
]).enableRLS();

export const billingPeriods = pgTable("billing_periods", {
  storeId: store().references(() => billingSubscriptions.storeId), requestId: uuid("request_id").primaryKey(),
  startsAt: date("starts_at").notNull(), endsAt: date("ends_at").notNull(), graceUntil: date("grace_until").notNull(),
}, (t) => [foreignKey({ columns: [t.storeId, t.requestId], foreignColumns: [billingRequests.storeId, billingRequests.id] }),
  index("billing_period_store").on(t.storeId, t.startsAt.desc()),
  check("billing_period_dates", sql`${t.startsAt} < ${t.endsAt} and ${t.endsAt} <= ${t.graceUntil}`)]).enableRLS();

export const billingProofs = pgTable("billing_proofs", {
  storeId: store(), requestId: uuid("request_id").primaryKey(), sha256: text().notNull().unique(),
  content: bytes().notNull(), submittedAt: now("submitted_at"),
}, (t) => [foreignKey({ columns: [t.storeId, t.requestId], foreignColumns: [billingRequests.storeId, billingRequests.id] }),
  check("billing_proof_valid", sql`${t.sha256} ~ '^[a-f0-9]{64}$' and octet_length(${t.content}) between 1 and 5242880`)]).enableRLS();

export const billingReviews = pgTable("billing_reviews", {
  storeId: store(), requestId: uuid("request_id").primaryKey(), reviewer: user("reviewer"),
  approved: boolean().notNull(), reason: text(), reconciliationRef: text("reconciliation_ref"),
  createdAt: now("created_at"),
}, (t) => [foreignKey({ columns: [t.storeId, t.requestId], foreignColumns: [billingRequests.storeId, billingRequests.id] }),
  check("billing_review_evidence", sql`case when ${t.approved} then ${t.reconciliationRef} is not null and ${t.reason} is null else ${t.reason} is not null and ${t.reconciliationRef} is null end`)]).enableRLS();

export const billingSetupRequests = pgTable("billing_setup_requests", {
  storeId: store(), requestId: uuid("request_id").primaryKey(), packageId: uuid("package_id").notNull().references(() => billingSetupPackages.id),
  label: text().notNull(), notes: text().notNull(), status: text().default("awaiting_payment").notNull(),
}, (t) => [foreignKey({ columns: [t.storeId, t.requestId], foreignColumns: [billingRequests.storeId, billingRequests.id] }),
  check("billing_setup_state", sql`${t.status} in ('awaiting_payment','paid','completed','closed') and length(${t.notes}) <= 1600`)]).enableRLS();

export const billingAudit = pgTable("billing_audit", {
  storeId: store(), id: uuid().defaultRandom().notNull(), requestId: uuid("request_id"),
  actorId: uuid("actor_id").references(() => users.id), event: text().notNull(), createdAt: now("created_at"),
}, (t) => [primaryKey({ columns: [t.storeId, t.id] }),
  foreignKey({ columns: [t.storeId, t.requestId], foreignColumns: [billingRequests.storeId, billingRequests.id] }),
  index("billing_audit_recent").on(t.storeId, t.createdAt.desc())]).enableRLS();
