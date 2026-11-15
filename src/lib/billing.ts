import { z } from "zod";
import { currencies, countries } from "./validation";

export const planCodes = ["starter", "pro"] as const;
export const intervals = ["monthly", "yearly"] as const;
export const subscriptionStates = ["trialing", "active", "pending_payment", "grace_period", "suspended", "canceled", "expired"] as const;
export const paymentStates = ["awaiting_payment", "submitted", "under_review", "approved", "rejected", "expired"] as const;
export const paymentMethods = z.enum(currencies);
const id = z.uuid();
const boundedText = (max: number) => z.string().trim().max(max).refine((v) => !/[\p{Cs}\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(v));
export const transferReference = boundedText(100).refine((v) => v.length >= 3 && !/[\r\n\t]/.test(v));
export const requestPayment = z.strictObject({
  key: id, price: id, method: id, setup: id.nullable(),
  expected: z.number().int().min(1).max(2_000_000_000), notes: boundedText(1600),
});
export const reviewPayment = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), amount: z.number().int().min(1).max(2_000_000_000),
    currency: paymentMethods, transfer: transferReference, independent: boundedText(120).refine((v) => v.length >= 3) }),
  z.object({ action: z.literal("reject"), reason: boundedText(800).refine((v) => v.length >= 3) }),
  z.object({ action: z.enum(["review", "complete_setup"]) }),
]);
export type PaymentInput = z.output<typeof requestPayment>;
export type ReviewInput = z.output<typeof reviewPayment>;
export type PaymentStatus = typeof paymentStates[number];
export type SubscriptionStatus = typeof subscriptionStates[number];
export type PlanCode = typeof planCodes[number];
export type BillingInterval = typeof intervals[number];
type Market = { country: typeof countries[number]; currency: typeof currencies[number] };
export type BillablePrice = Market & { id: string; plan: PlanCode; version: number; maxProducts: number; interval: BillingInterval; amount: number };
type MarketOption = Market & { id: string; label: string };
export type BillableMethod = MarketOption & { instructions: string };
export type SetupPackage = MarketOption & { amount: number };
export type BillingOptions = { trialDays: number; eligible: boolean; prices: BillablePrice[]; methods: BillableMethod[]; packages: SetupPackage[] };
export type BillingUsage = { products: number; storageBytes: number; confirmed: number; byChannel: { whatsapp?: number; instagram?: number } | null };
export type Subscription = {
  status: SubscriptionStatus; legacy: boolean; onboarding: boolean; pending: boolean;
  plan: PlanCode | null; version: number | null; interval: BillingInterval | null; currency: Market["currency"] | null;
  trialEnd: string | null; accountTrialEnd?: string | null; manualMonths?: number | null;
  periodStart: string | null; periodEnd: string | null; paidUntil?: string | null; graceUntil: string | null;
  cancelAt: string | null; nextPeriod: string | null; nextPlan: PlanCode | null;
  legacyUntil?: string | null;
};
export type ManualTermRow = {
  id: string;
  plan: PlanCode;
  months: number;
  amountMinor: number;
  currency: Market["currency"];
  reference: string;
  note: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
};
export type ReviewRow = Market & {
  id: string; reference: string; status: PaymentStatus; plan: PlanCode; version: number; interval: BillingInterval;
  planMinor: number; setupMinor: number; merchant: string; store: string; createdAt: string; method: string;
  transactionRef: string | null; reason: string | null; reconciliation: string | null; hasProof: boolean;
  setupLabel: string | null; setupStatus: string | null; setupNotes: string | null; mayReview: boolean;
};

export type BillingError = "invalid" | "denied" | "closed" | "pending" | "duplicate" | "price" | "ineligible" | "unavailable" | "independent";

export function registrationAvailable(origin: string | undefined, enabled: string | undefined) {
  if (enabled !== "true" || !origin) return false;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }
  catch { return false; }
}
