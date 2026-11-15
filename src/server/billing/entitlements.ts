import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { familyThemeIds, type ThemeId } from "@/lib/theme-config";
import type { Transaction } from "@/server/db/actor";

export type Entitlements = {
  publish: boolean; maxProducts: number; storageMiB: number; analytics: "basic" | "enhanced";
  luxury: boolean; premium: boolean; customDomain: false;
};

export async function billingValue<T>(tx: Transaction, query: SQL) {
  return (await tx.execute<{ value: T }>(query)).rows[0]?.value;
}

export async function entitlements(tx: Transaction, storeId: string) {
  const value = await billingValue<Entitlements>(tx, sql`select public.billing_entitlements(${storeId}) as value`);
  if (!value) throw new Error("Missing store entitlements.");
  return value;
}

export function entitledThemes(luxury: boolean): ThemeId[] {
  return luxury ? ["minimal-commerce", "luxury-boutique", ...familyThemeIds] : ["minimal-commerce", ...familyThemeIds];
}
