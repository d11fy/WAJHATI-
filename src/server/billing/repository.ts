import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { requestPayment, reviewPayment, transferReference, type BillingError, type BillingOptions, type BillingUsage, type ManualTermRow, type PaymentInput, type ReviewInput, type ReviewRow, type Subscription } from "@/lib/billing";
import { catalogId } from "@/lib/catalog";
import type { ContactSettings } from "@/lib/platform-contact";
import { isSessionToken } from "@/server/auth/crypto";
import { database } from "@/server/db/client";
import { billingPlans, billingRequests, billingReviews, billingSetupRequests } from "@/server/db/billing-schema";
import { platformManualTerms } from "@/server/db/platform-schema";
import { withMerchantStore } from "@/server/stores/repository";
import { billingValue, entitlements } from "./entitlements";
import { openProof, type ProofArchive } from "./proof-archive";

type Outcome = "ok" | BillingError;
const pageSize = 20;
const offsetFor = (page: number) => (Math.min(Math.max(1, page), 1000) - 1) * pageSize;

export function merchantBilling(user: string, slug: string, page: number) {
  return withMerchantStore(user, slug, false, async (tx, store) => {
    if (store.role !== "owner") return null;
    const state = await billingValue<Subscription>(tx, sql`select public.billing_merchant_state(${store.id}) as value`);
    const options = await billingValue<BillingOptions>(tx, sql`select public.billing_options(${store.id}) as value`);
    const usage = await billingValue<BillingUsage>(tx, sql`select public.billing_usage(${store.id}) as value`);
    const contact = await billingValue<ContactSettings>(tx, sql`select public.platform_contact_public() as value`);
    if (!state || !options || !usage) return null;
    const rights = await entitlements(tx, store.id);
    const manualHistory = await tx.select({
      id: platformManualTerms.id,
      plan: sql<ManualTermRow["plan"]>`${billingPlans.code}`,
      months: platformManualTerms.months,
      amountMinor: platformManualTerms.amountMinor,
      currency: platformManualTerms.currency,
      reference: platformManualTerms.reference,
      note: platformManualTerms.note,
      startsAt: platformManualTerms.startsAt,
      endsAt: platformManualTerms.endsAt,
      createdAt: platformManualTerms.createdAt,
    }).from(platformManualTerms)
      .innerJoin(billingPlans, eq(billingPlans.id, platformManualTerms.planId))
      .where(eq(platformManualTerms.storeId, store.id))
      .orderBy(desc(platformManualTerms.createdAt), platformManualTerms.id)
      .limit(pageSize);
    const rows = await tx.select({
      id: billingRequests.id, reference: billingRequests.reference, currency: billingRequests.currency,
      planMinor: billingRequests.planMinor, setupMinor: billingRequests.setupMinor, interval: billingRequests.interval,
      status: sql<typeof billingRequests.status._.data>`case when ${billingRequests.status} = 'awaiting_payment' and ${billingRequests.expiresAt} <= now()
        then 'expired'::public.billing_payment_status else ${billingRequests.status} end`,
      createdAt: billingRequests.createdAt, expiresAt: billingRequests.expiresAt,
      instructions: billingRequests.instructions, method: billingRequests.methodLabel,
      reason: billingReviews.reason, setupLabel: billingSetupRequests.label, setupStatus: billingSetupRequests.status,
    }).from(billingRequests).leftJoin(billingReviews, and(eq(billingReviews.storeId, store.id), eq(billingReviews.requestId, billingRequests.id)))
      .leftJoin(billingSetupRequests, and(eq(billingSetupRequests.storeId, store.id), eq(billingSetupRequests.requestId, billingRequests.id)))
      .where(eq(billingRequests.storeId, store.id)).orderBy(desc(billingRequests.createdAt), billingRequests.id)
      .limit(pageSize + 1).offset(offsetFor(page));
    return { store, state, options, usage, rights, contact, manualHistory, history: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
  });
}

export function trialForStore(user: string, slug: string) {
  return withMerchantStore(user, slug, true, async (tx, store) =>
    await billingValue<Outcome>(tx, sql`select public.billing_start_trial(${store.id}) as value`) ?? "unavailable");
}

export function cancelAtEnd(user: string, slug: string, cancel: boolean) {
  return withMerchantStore(user, slug, true, async (tx, store) =>
    await billingValue<Outcome>(tx, sql`select public.billing_cancel_at_end(${store.id}, ${cancel}) as value`) ?? "unavailable");
}

export function createPaymentRequest(user: string, slug: string, input: PaymentInput) {
  if (!requestPayment.safeParse(input).success) return Promise.resolve({ error: "invalid" as const });
  return withMerchantStore(user, slug, true, async (tx, store) => {
    const { key, price, method, setup, expected, notes } = input;
    return billingValue<{ id: string } | { error: BillingError }>(tx, sql`
      select public.billing_request_payment(${store.id}, ${key}, ${price}, ${method}, ${setup}, ${expected}, ${notes}) as value
    `);
  });
}

export function canUploadProof(user: string, slug: string, id: string) {
  if (!catalogId.safeParse(id).success) return Promise.resolve(false);
  return withMerchantStore(user, slug, false, async (tx, store) => {
    if (store.role !== "owner") return false;
    const [row] = await tx.select({ id: billingRequests.id }).from(billingRequests).where(and(
      eq(billingRequests.storeId, store.id), eq(billingRequests.id, id),
      sql`(${billingRequests.status} in ('submitted','under_review') or
        (${billingRequests.status} = 'awaiting_payment' and ${billingRequests.expiresAt} > now()))`,
    ));
    return Boolean(row);
  });
}

export function submitProof(user: string, slug: string, id: string, ref: string, content: Buffer, hash: string, source?: ProofArchive) {
  const validated = transferReference.safeParse(ref);
  if (!catalogId.safeParse(id).success || !validated.success) return Promise.resolve("invalid" as const);
  return withMerchantStore(user, slug, true, async (tx, store) => {
    const result = await billingValue<Outcome>(tx, sql`select public.billing_submit_proof(${store.id}, ${id}, ${validated.data}, ${content}, ${hash}) as value`);
    if (result === "ok" && source) {
      const stored = await billingValue<boolean>(tx, sql`
        select public.platform_archive_proof_versioned(${store.id},${id},${source.cipher},${source.originalType},${source.sha256},${source.keyId ?? null}) as value
      `);
      if (!stored) throw new Error("Original proof could not be stored.");
    }
    return result ?? "unavailable";
  });
}

export async function mayReviewPayments(token: string | undefined) {
  if (!isSessionToken(token)) return false;
  try {
    const result = await (await database()).execute<{ allowed: boolean }>(sql`select public.billing_review_access(${token}) as allowed`);
    return result.rows[0]?.allowed === true;
  } catch { throw new Error("Payment review authorization failed."); }
}

export async function listPaymentReviews(token: string | undefined, id: string | null, pending: boolean, page: number) {
  if (!isSessionToken(token) || (id !== null && !catalogId.safeParse(id).success)) return [];
  try {
    const result = await (await database()).execute<{ value: ReviewRow }>(sql`
      select value from public.billing_review_list(${token}, ${id}, ${pending}, ${offsetFor(page)}) as value
    `);
    return result.rows.map(({ value }) => value);
  } catch { throw new Error("Payment review listing failed."); }
}

export async function downloadProof(token: string | undefined, id: string) {
  if (!isSessionToken(token) || !catalogId.safeParse(id).success) return null;
  const result = await (await database()).execute<{ content: Buffer | null }>(sql`select public.billing_private_proof(${token}, ${id}) as content`);
  return result.rows[0]?.content ?? null;
}

export async function downloadOriginal(token: string | undefined, id: string) {
  if (!isSessionToken(token) || !catalogId.safeParse(id).success) return null;
  const { rows: [row] } = await (await database()).execute<{ cipher: Buffer; original_type: string; sha256: string; key_id: string | null }>(
    sql`select * from public.platform_proof_source_versioned(${token},${id})`);
  if (!row) return null;
  return { content: openProof(id, { cipher: row.cipher, originalType: row.original_type, sha256: row.sha256, keyId: row.key_id }), type: row.original_type };
}

export async function reviewRequest(token: string | undefined, id: string, input: ReviewInput) {
  if (!isSessionToken(token) || !catalogId.safeParse(id).success) return "denied";
  const parsed = reviewPayment.safeParse(input);
  if (!parsed.success) return "invalid";
  const review = parsed.data;
  const approved = review.action === "approve" ? review : null;
  const result = await (await database()).execute<{ value: Outcome | "secondReview" }>(sql`
    select public.billing_review_payment(${token}, ${id}, ${review.action}, ${approved?.amount ?? null},
      ${approved?.currency ?? null}, ${approved?.transfer ?? null}, ${approved?.independent ?? null},
      ${review.action === "reject" ? review.reason : null}) as value
  `);
  return result.rows[0]?.value ?? "unavailable";
}
