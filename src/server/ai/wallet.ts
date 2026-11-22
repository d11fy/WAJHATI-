import "server-only";
import { sql } from "drizzle-orm";
import type { Transaction } from "@/server/db/actor";
import { withMerchantStore } from "@/server/stores/repository";

/**
 * Thin typed wrappers over the SECURITY DEFINER functions of migration 0030. The functions own every rule (membership, entitlement,
 * cycles, limits, atomic reservation); this file only shapes inputs and results. A merchant session has no write access to the tables.
 */
export type Wallet = {
  enabled: boolean; suspended: boolean; billing: string; balance: number; extra: number; allocation: number;
  kind: "trial" | "subscription" | null; cycleStart: string | null; cycleEnd: string | null; costs: Record<string, number>;
};
export type ReserveResult =
  | { status: "ok"; requestId: string; cost: number; balance: number; extra: number }
  | { status: "denied" | "disabled" | "suspended" | "rate_limited" | "no_plan" | "insufficient" | "invalid" | "duplicate"; balance?: number; extra?: number; cost?: number };

async function value<T>(tx: Transaction, query: ReturnType<typeof sql>) {
  return (await tx.execute<{ value: T }>(query)).rows[0]?.value;
}

export function readWallet(tx: Transaction, storeId: string) {
  return value<Wallet | null>(tx, sql`select public.ai_wallet(${storeId}) as value`);
}

export function getWallet(userId: string, slug: string) {
  return withMerchantStore(userId, slug, false, async (tx, store) => ({ store, wallet: await readWallet(tx, store.id) }));
}

export function reserveCredits(tx: Transaction, storeId: string, operation: string, key: string) {
  return value<ReserveResult>(tx, sql`select public.ai_reserve(${storeId}, ${operation}, ${key}::uuid) as value`);
}

export type Usage = { inputTokens: number; outputTokens: number; costUsd: number; provider: string; model: string; ms: number };

export function commitCredits(tx: Transaction, requestId: string, usage: Usage) {
  return value<boolean>(tx, sql`select public.ai_commit(${requestId}::uuid, ${usage.inputTokens}, ${usage.outputTokens}, ${usage.costUsd}, ${usage.provider}, ${usage.model}, ${usage.ms}) as value`);
}

export function releaseCredits(tx: Transaction, requestId: string, error: string, usage?: Partial<Usage>) {
  return value<boolean>(tx, sql`select public.ai_release(${requestId}::uuid, ${error}, ${usage?.inputTokens ?? null}, ${usage?.outputTokens ?? null}, ${usage?.costUsd ?? null},
    ${usage?.provider ?? null}, ${usage?.model ?? null}, ${usage?.ms ?? null}) as value`);
}

/** Estimated USD cost from token counts and the prices configured by the administrator (per million tokens). */
export function estimateCostUsd(inputTokens: number, outputTokens: number, price: { input: number; output: number }) {
  return Math.round(((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * 1_000_000) / 1_000_000;
}

export async function readPrices(tx: Transaction) {
  const { rows } = await tx.execute<{ usd_per_million_input: string; usd_per_million_output: string }>(sql`select usd_per_million_input, usd_per_million_output from public.ai_settings where id = 1`);
  return { input: Number(rows[0]?.usd_per_million_input ?? 0), output: Number(rows[0]?.usd_per_million_output ?? 0) };
}
