import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { database } from "@/server/db/client";
import { isSessionToken } from "@/server/auth/crypto";

export type Role = "owner" | "administrator" | "reviewer";
export type PlatformAccess = { roles: Role[]; enrolled: boolean; elevated: boolean; fresh: boolean };
export type PlatformArea = "overview" | "merchants" | "stores" | "subscriptions" | "plans" | "payments" | "setup" | "themes" | "settings" | "audit" | "jobs";
export type PlatformResult = "ok" | "invalid" | "denied" | "unavailable";

async function value<T>(query: SQL) {
  try {
    const { rows } = await (await database()).execute<{ value: T }>(query);
    return rows[0]?.value;
  } catch { throw new Error("Platform operation failed."); }
}

export async function platformAccess(token: string | undefined) {
  if (!isSessionToken(token)) return null;
  return await value<PlatformAccess | null>(sql`select public.platform_access(${token}) as value`) ?? null;
}

export function mfaConfigured() {
  return /^[a-f0-9]{64}$/.test(process.env.PLATFORM_MFA_KEY ?? "");
}

export async function mfaSeed(token: string | undefined, code: string, recovery: boolean) {
  if (!isSessionToken(token) || !mfaConfigured()) return null;
  const key = process.env.PLATFORM_MFA_KEY!;
  return await value<string | null>(recovery
    ? sql`select public.platform_mfa_recover(${token},${code},${key}) as value`
    : sql`select public.platform_mfa_begin(${token},${code},${key}) as value`) ?? null;
}

export async function mfaVerify(token: string | undefined, code: string) {
  if (!isSessionToken(token) || !mfaConfigured()) return null;
  return await value<{ ok: true; recovery: string[] | null; token: string; expiresAt: string } | null>(
    sql`select public.platform_mfa_verify(${token},${code},${process.env.PLATFORM_MFA_KEY!}) as value`) ?? null;
}

export async function platformRows<T>(token: string | undefined, area: PlatformArea, q = "", page = 1, filter = "") {
  if (!isSessionToken(token)) return [];
  try {
    const { rows } = await (await database()).execute<{ value: T }>(sql`
      select value from public.platform_query(${token},${area},${q},${(page - 1) * 20},${filter}) as value
    `);
    return rows.map(({ value }) => value);
  } catch { throw new Error("Platform listing failed."); }
}

export async function supportOperation(token: string | undefined, id: string, action: string, reason: string) {
  if (!isSessionToken(token)) return "denied";
  return await value<PlatformResult>(sql`select public.platform_support(${token},${id},${action},${reason}) as value`) ?? "unavailable";
}

export async function changeRole(token: string | undefined, id: string, role: Role, grant: boolean) {
  if (!isSessionToken(token)) return "denied";
  return await value<PlatformResult>(sql`select public.platform_role_change(${token},${id},${role},${grant}) as value`) ?? "unavailable";
}

export async function configurePlatform(token: string | undefined, action: string, fields: unknown) {
  if (!isSessionToken(token)) return "denied";
  return await value<PlatformResult>(sql`select public.platform_configure(${token},${action},${JSON.stringify(fields)}::jsonb) as value`) ?? "unavailable";
}

export async function paymentStage(token: string | undefined, id: string) {
  if (!isSessionToken(token)) return null;
  return await value<{ waiting: boolean; initiatedHere: boolean; source: boolean }>(
    sql`select public.platform_payment_stage(${token},${id}) as value`) ?? null;
}
