import "server-only";
import { sql } from "drizzle-orm";
import { isSessionToken } from "@/server/auth/crypto";
import { database } from "@/server/db/client";

export type AiAdminOverview = {
  settings: { enabled: boolean; per_minute: number; per_day: number; trial_credits: number; monthly_credits: number; usd_per_million_input: string; usd_per_million_output: string; reservation_minutes: number };
  costs: { operation: string; credits: number; active: boolean }[];
  totals: { requests: number; succeeded: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number | string; consumed: number };
  granted: { allocated: number; adminGranted: number; adminWithdrawn: number };
  top: { store: string; slug: string; consumed: number; requests: number; costUsd: number | string }[];
  failures: { store: string; operation: string; error: string | null; at: string }[];
  suspended: { slug: string; reason: string | null }[];
};
export type AiAdminResult = "ok" | "invalid" | "denied" | "unavailable";

async function value<T>(query: ReturnType<typeof sql>) {
  try { return (await (await database()).execute<{ value: T }>(query)).rows[0]?.value; } catch { throw new Error("AI administration failed."); }
}

export async function aiAdminOverview(token: string | undefined) {
  if (!isSessionToken(token)) return null;
  return (await value<AiAdminOverview | null>(sql`select public.ai_admin_overview(${token}) as value`)) ?? null;
}

export async function aiAdminConfigure(token: string | undefined, action: "settings" | "cost" | "store_suspend", data: unknown): Promise<AiAdminResult> {
  if (!isSessionToken(token)) return "denied";
  return (await value<AiAdminResult>(sql`select public.ai_admin_configure(${token}, ${action}, ${JSON.stringify(data)}::jsonb) as value`)) ?? "unavailable";
}

export async function aiAdminAdjust(token: string | undefined, slug: string, delta: number, note: string): Promise<AiAdminResult> {
  if (!isSessionToken(token)) return "denied";
  return (await value<AiAdminResult>(sql`select public.ai_admin_adjust(${token}, ${slug}, ${delta}, ${note}) as value`)) ?? "unavailable";
}
