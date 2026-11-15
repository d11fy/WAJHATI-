import "server-only";
import { sql } from "drizzle-orm";
import type { BillablePrice } from "@/lib/billing";
import { database } from "@/server/db/client";

export type MarketingOffer = Omit<BillablePrice, "id" | "version"> & {
  storageMiB: number;
  analytics: "basic" | "enhanced";
  luxury: boolean;
};
export type PublishedPlan = MarketingOffer & { name: string; premium: boolean; canPurchase: boolean };

export async function marketingBilling() {
  try {
    const db = await database();
    const { rows } = await db.execute<{ value: { trialDays: number | null; offers: MarketingOffer[]; catalog?: PublishedPlan[] } }>(
      sql`select public.billing_marketing() as value`,
    );
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}
