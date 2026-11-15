import { sql } from "drizzle-orm";
import { bigserial, boolean, check, customType, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { billingPlans, billingProofs, billingRequests } from "./billing-schema";
import { currencyCode, sessions, stores, users } from "./schema";

const date = (name: string) => timestamp(name, { withTimezone: true });
const created = (name: string) => date(name).defaultNow().notNull();
const user = (name: string) => uuid(name).references(() => users.id, { onDelete: "cascade" });
const store = () => uuid("store_id").references(() => stores.id, { onDelete: "cascade" });
const bytes = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const platformRole = pgEnum("platform_role", ["owner", "administrator", "reviewer"]);
export const identityPurpose = pgEnum("identity_purpose", ["signup", "verify", "reset", "change_old", "change_new"]);

export const identityChanges = pgTable("identity_changes", {
  id: uuid().defaultRandom().primaryKey(), userId: user("user_id").notNull(), oldEmail: text("old_email").notNull(), newEmail: text("new_email").notNull(),
  expiresAt: date("expires_at").notNull(), oldConfirmed: boolean("old_confirmed").default(false).notNull(), newConfirmed: boolean("new_confirmed").default(false).notNull(),
}, (t) => [index("identity_changes_user").on(t.userId)]).enableRLS();

export const identityTokens = pgTable("identity_tokens", {
  hash: varchar({ length: 64 }).primaryKey(), purpose: identityPurpose().notNull(), email: text().notNull(), userId: user("user_id"),
  changeId: uuid("change_id").references(() => identityChanges.id, { onDelete: "cascade" }), expiresAt: date("expires_at").notNull(),
}, (t) => [index("identity_tokens_expiry").on(t.expiresAt), index("identity_tokens_user").on(t.userId),
  check("identity_token_hash", sql`${t.hash} ~ '^[a-f0-9]{64}$'`)]).enableRLS();

export const platformRoles = pgTable("platform_roles", {
  userId: user("user_id").notNull(), role: platformRole().notNull(), grantedAt: created("granted_at"),
}, (t) => [primaryKey({ columns: [t.userId, t.role] })]).enableRLS();

export const platformMfa = pgTable("platform_mfa", {
  userId: user("user_id").primaryKey(), secret: bytes(), enrollmentHash: varchar("enrollment_hash", { length: 64 }),
  enrollmentExpiry: date("enrollment_expiry"), enrollmentSession: varchar("enrollment_session", { length: 64 }),
  enabled: boolean().default(false).notNull(), lastCounter: integer("last_counter").default(-1).notNull(),
  attemptStart: created("attempt_start"), attempts: integer().default(0).notNull(),
}).enableRLS();

export const platformRecovery = pgTable("platform_recovery", {
  userId: user("user_id").notNull(), hash: varchar({ length: 64 }).notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.hash] })]).enableRLS();

export const platformElevations = pgTable("platform_elevations", {
  sessionHash: varchar("session_hash", { length: 64 }).primaryKey().references(() => sessions.tokenHash, { onDelete: "cascade" }),
  verifiedAt: created("verified_at"),
}).enableRLS();

export const platformControls = pgTable("platform_controls", {
  storeId: store().primaryKey(), suspended: boolean().default(false).notNull(), hold: boolean().default(false).notNull(), changedAt: created("changed_at"),
}).enableRLS();

export const platformLegacy = pgTable("platform_legacy", {
  storeId: store().primaryKey(), until: date("until").notNull(), classifiedAt: created("classified_at"),
}).enableRLS();

export const platformPolicy = pgTable("platform_policy", {
  id: integer().primaryKey().default(1), dualThresholds: jsonb("dual_thresholds").$type<Record<string, number>>().notNull().default({}),
  allowTrials: boolean("allow_trials").notNull().default(true), luxuryEnabled: boolean("luxury_enabled").notNull().default(true),
  adminMaySuspend: boolean("admin_may_suspend").notNull().default(true),
}, (t) => [check("platform_policy_singleton", sql`${t.id}=1`)]).enableRLS();

export const platformPaymentChecks = pgTable("platform_payment_checks", {
  requestId: uuid("request_id").primaryKey().references(() => billingRequests.id), reviewer: user("reviewer").notNull(),
  reconciliation: text().notNull(), createdAt: created("created_at"),
}).enableRLS();

export const platformProofSources = pgTable("platform_proof_sources", {
  requestId: uuid("request_id").primaryKey().references(() => billingProofs.requestId, { onDelete: "cascade" }),
  cipher: bytes().notNull(), originalType: text("original_type").notNull(), sha256: varchar({ length: 64 }).notNull(), keyId: varchar("key_id",{length:24}),
}, (t) => [check("platform_proof_limits", sql`octet_length(${t.cipher}) between 29 and 5242908 and ${t.originalType} in ('application/pdf','image/png','image/jpeg','image/webp') and ${t.sha256} ~ '^[a-f0-9]{64}$'`)]).enableRLS();

export const platformEvents = pgTable("platform_events", {
  id: bigserial({ mode: "number" }).primaryKey(), actor: uuid(), subject: uuid(), action: text().notNull(),
  detail: jsonb().notNull().default({}), createdAt: created("created_at"), previous: varchar({ length: 64 }).notNull(), hash: varchar({ length: 64 }).notNull(),
}).enableRLS();

export const platformJobs = pgTable("platform_jobs", {
  id: uuid().defaultRandom().primaryKey(), job: text().notNull(), startedAt: created("started_at"), finishedAt: date("finished_at"),
  success: boolean(), details: jsonb().notNull().default({}),
}, (t) => [index("platform_jobs_recent").on(t.job, t.startedAt.desc())]).enableRLS();

export const opsNotifications = pgTable("ops_notifications", {
  id: uuid().defaultRandom().primaryKey(), kind: text().notNull(), recipient: user("recipient").notNull(),
  subject: uuid().notNull(), window: text().notNull(), createdAt: created("created_at"), dueAt: created("due_at"),
  attempts: integer().default(0).notNull(), lease: uuid(), sentAt: date("sent_at"), failedAt: date("failed_at"),
}, (t) => [
  index("ops_notifications_pending").on(t.dueAt,t.id).where(sql`${t.sentAt} is null and ${t.failedAt} is null`),
  uniqueIndex("ops_notifications_dedupe").on(t.kind,t.recipient,t.subject,t.window),
  check("ops_notifications_kind",sql`${t.kind} in ('billing_due','review_pending','subscription_active','subscription_expired','trial_started') and ${t.attempts} between 0 and 6`),
]).enableRLS();

export const platformContact = pgTable("platform_contact", {
  id: integer().primaryKey().default(1), enabled: boolean().notNull().default(true), whatsapp: varchar({ length: 16 }).notNull(),
}, (t) => [check("platform_contact_valid", sql`${t.id}=1 and ${t.whatsapp} ~ '^[1-9][0-9]{7,14}$'`)]).enableRLS();

export const platformMail = pgTable("platform_mail", {
  id: integer().primaryKey().default(1), config: jsonb().notNull(), cipher: bytes().notNull(), revision: uuid().notNull().defaultRandom(),
  enabled: boolean().notNull().default(false), verifiedAt: date("verified_at"), changedAt: created("changed_at"),
}, (t) => [check("platform_mail_valid", sql`${t.id}=1 and octet_length(${t.cipher}) between 29 and 4096`)]).enableRLS();

export const platformAccountTrials = pgTable("platform_account_trials", {
  userId: user("user_id").primaryKey(), startsAt: created("starts_at"), endsAt: date("ends_at").notNull(),
}, (t) => [check("platform_account_trial_dates", sql`${t.endsAt}>${t.startsAt}`)]).enableRLS();

export const platformManualTerms = pgTable("platform_manual_terms", {
  id: uuid().primaryKey(), storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  planId: uuid("plan_id").notNull().references(() => billingPlans.id), months: integer().notNull(), amountMinor: integer("amount_minor").notNull(),
  currency: currencyCode().notNull().default("ILS"), reference: varchar({ length: 120 }).notNull(), note: varchar({ length: 500 }).notNull().default(""),
  actor: uuid().notNull().references(() => users.id), approvedBy: uuid("approved_by").references(() => users.id),
  createdAt: created("created_at"), startsAt: date("starts_at"), endsAt: date("ends_at"),
}, (t) => [uniqueIndex("platform_manual_reference").on(t.reference), index("platform_manual_store").on(t.storeId,t.endsAt),
  check("platform_manual_valid", sql`${t.months} in (1,3,6,12) and ${t.amountMinor} between 1 and 1000000000 and length(btrim(${t.reference})) between 3 and 120 and length(${t.note})<=500 and ((${t.startsAt} is null and ${t.endsAt} is null and ${t.approvedBy} is null) or (${t.startsAt} is not null and ${t.endsAt}>${t.startsAt} and ${t.approvedBy} is not null))`),
]).enableRLS();
