import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { stores } from "./schema";

/**
 * Type mirror of migration 0030 (WAJHATI AI credits). The migration SQL is the source of truth for constraints, RLS, triggers and the
 * SECURITY DEFINER functions. The runtime role can only read these tables; every write goes through those functions.
 */
const store = () => uuid("store_id").notNull().references(() => stores.id, { onDelete: "cascade" });
const at = (name: string) => timestamp(name, { withTimezone: true });

export const aiSettings = pgTable("ai_settings", {
  id: integer().primaryKey().default(1), enabled: boolean().notNull().default(true), perMinute: integer("per_minute").notNull().default(6),
  perDay: integer("per_day").notNull().default(150), trialCredits: integer("trial_credits").notNull().default(30), monthlyCredits: integer("monthly_credits").notNull().default(600),
  usdPerMillionInput: numeric("usd_per_million_input", { precision: 10, scale: 4 }).notNull().default("0.14"),
  usdPerMillionOutput: numeric("usd_per_million_output", { precision: 10, scale: 4 }).notNull().default("0.28"),
  reservationMinutes: integer("reservation_minutes").notNull().default(5), updatedAt: at("updated_at").notNull().defaultNow(),
}).enableRLS();

export const aiOperationCosts = pgTable("ai_operation_costs", {
  operation: text().primaryKey(), credits: integer().notNull(), active: boolean().notNull().default(true),
}).enableRLS();

export const aiStoreControls = pgTable("ai_store_controls", {
  storeId: store().primaryKey(), suspended: boolean().notNull().default(false), reason: text(), updatedAt: at("updated_at").notNull().defaultNow(),
}).enableRLS();

export const aiWallets = pgTable("ai_wallets", {
  storeId: store().primaryKey(), balance: integer().notNull().default(0), extra: integer().notNull().default(0),
  cycleKey: text("cycle_key"), cycleKind: text("cycle_kind"), cycleCredits: integer("cycle_credits").notNull().default(0),
  cycleStart: at("cycle_start"), cycleEnd: at("cycle_end"), updatedAt: at("updated_at").notNull().defaultNow(),
}).enableRLS();

export const aiAllocations = pgTable("ai_allocations", {
  id: uuid().primaryKey().defaultRandom(), storeId: store(), kind: text().notNull(), cycleKey: text("cycle_key").notNull(), credits: integer().notNull(),
  startsAt: at("starts_at").notNull(), endsAt: at("ends_at").notNull(), createdAt: at("created_at").notNull().defaultNow(),
}, (t) => [unique("ai_allocation_once").on(t.storeId, t.cycleKey)]).enableRLS();

export const aiTrialClaims = pgTable("ai_trial_claims", {
  userId: uuid("user_id").primaryKey(), storeId: store(), claimedAt: at("claimed_at").notNull().defaultNow(),
}).enableRLS();

export const aiRequests = pgTable("ai_requests", {
  id: uuid().primaryKey().defaultRandom(), storeId: store(), userId: uuid("user_id"), operation: text().notNull().references(() => aiOperationCosts.operation),
  idempotencyKey: uuid("idempotency_key").notNull(), status: text().notNull().default("reserved"), credits: integer().notNull(),
  fromCycle: integer("from_cycle").notNull(), fromExtra: integer("from_extra").notNull(), cycleKey: text("cycle_key"),
  provider: text(), model: text(), inputTokens: integer("input_tokens"), outputTokens: integer("output_tokens"),
  estCostUsd: numeric("est_cost_usd", { precision: 12, scale: 6 }), latencyMs: integer("latency_ms"), errorCode: text("error_code"),
  createdAt: at("created_at").notNull().defaultNow(), expiresAt: at("expires_at").notNull(), finishedAt: at("finished_at"),
}, (t) => [unique("ai_request_key").on(t.storeId, t.idempotencyKey), index("ai_request_recent").on(t.storeId, t.createdAt.desc()),
  check("ai_request_split", sql`${t.fromCycle} + ${t.fromExtra} = ${t.credits}`)]).enableRLS();

export const aiLedger = pgTable("ai_ledger", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(), storeId: store(), kind: text().notNull(), delta: integer().notNull(),
  balanceAfter: integer("balance_after").notNull(), extraAfter: integer("extra_after").notNull(), requestId: uuid("request_id"), actorId: uuid("actor_id"),
  note: text(), createdAt: at("created_at").notNull().defaultNow(),
}, (t) => [index("ai_ledger_store").on(t.storeId, t.id.desc())]).enableRLS();
