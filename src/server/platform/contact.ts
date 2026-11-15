import "server-only";
import { sql } from "drizzle-orm";
import { isSessionToken } from "@/server/auth/crypto";
import { database, identityDatabase } from "@/server/db/client";
import { normalizeWhatsappPhone, type ContactSettings, type SmtpConfig, type SubscriptionMonths } from "@/lib/platform-contact";
import type { Currency } from "@/lib/catalog";
import type { PlatformResult } from "./repository";

export type MailView = {
  config: SmtpConfig;
  enabled: boolean;
  verifiedAt: string | null;
  changedAt?: string | null;
  revision: string;
  hasPassword: boolean;
};

export type ManualSubscriptionInput = {
  id: string;
  user: string;
  store: string;
  plan: "starter" | "pro";
  months: SubscriptionMonths;
  amountMinor: number;
  currency: Currency;
  reference: string;
  note?: string;
};

export async function contactSettings(): Promise<ContactSettings | null> {
  try {
    const { rows } = await (await database()).execute<{ value: ContactSettings }>(sql`select public.platform_contact_public() as value`);
    return rows[0]?.value ?? null;
  } catch {
    return null;
  }
}

export async function saveContact(token: string | undefined, phone: string, enabled = true): Promise<PlatformResult> {
  if (!isSessionToken(token)) return "denied";
  const normalized = normalizeWhatsappPhone(phone);
  if (!normalized) return "invalid";
  const { rows } = await (await database()).execute<{ value: PlatformResult }>(
    sql`select public.platform_contact_save(${token},${normalized},${enabled}) as value`,
  );
  return rows[0]?.value ?? "unavailable";
}

export async function mailView(token: string | undefined) {
  if (!isSessionToken(token)) return null;
  const { rows } = await (await database()).execute<{ value: MailView | null }>(sql`select public.platform_mail_view(${token}) as value`);
  return rows[0]?.value ?? null;
}

export async function mailSecret() {
  const { rows } = await (await identityDatabase()).execute<{
    config: SmtpConfig;
    cipher: Buffer;
    enabled: boolean;
    revision: string;
    verified_at: string | null;
  }>(sql`select * from public.platform_mail_secret()`);
  return rows[0] ?? null;
}

export async function saveMail(token: string | undefined, config: SmtpConfig, cipher: Buffer | null, enabled: boolean): Promise<PlatformResult> {
  if (!isSessionToken(token)) return "denied";
  const { rows } = await (await database()).execute<{ value: PlatformResult }>(
    sql`select public.platform_mail_save(${token},${JSON.stringify(config)}::jsonb,${cipher}::bytea,${enabled}) as value`,
  );
  return rows[0]?.value ?? "unavailable";
}

export async function recordMailTest(token: string | undefined, revision: string, success: boolean): Promise<PlatformResult> {
  if (!isSessionToken(token)) return "denied";
  const { rows } = await (await database()).execute<{ value: PlatformResult }>(
    sql`select public.platform_mail_tested(${token},${revision}::uuid,${success}) as value`,
  );
  return rows[0]?.value ?? "unavailable";
}

export async function grantManualSubscription(token: string | undefined, input: ManualSubscriptionInput): Promise<PlatformResult> {
  if (!isSessionToken(token)) return "denied";
  const { rows } = await (await database()).execute<{ value: PlatformResult }>(sql`
    select public.platform_manual_grant(
      ${token},
      ${input.user}::uuid,
      ${input.store}::uuid,
      ${input.id}::uuid,
      ${input.months},
      ${input.amountMinor},
      ${input.reference},
      ${input.plan},
      ${input.currency}::public.currency_code,
      ${input.note ?? ""}
    ) as value
  `);
  return rows[0]?.value ?? "unavailable";
}

export async function confirmManualSubscription(token: string | undefined, id: string): Promise<PlatformResult> {
  if (!isSessionToken(token)) return "denied";
  const { rows } = await (await database()).execute<{ value: PlatformResult }>(
    sql`select public.platform_manual_confirm(${token},${id}::uuid) as value`,
  );
  return rows[0]?.value ?? "unavailable";
}
