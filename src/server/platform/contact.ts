import "server-only";
import { sql } from "drizzle-orm";
import { isSessionToken } from "@/server/auth/crypto";
import { database, identityDatabase, mailerDatabase } from "@/server/db/client";
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

/** The mail delivery process has its own narrow login. Every other process keeps using the runtime and identity logins. */
const inMailer = () => Boolean(process.env.MAIL_WORKER_DATABASE_URL);

export async function contactSettings(): Promise<ContactSettings | null> {
  try {
    const handle = inMailer() ? await mailerDatabase() : await database();
    const { rows } = await handle.execute<{ value: ContactSettings }>(sql`select public.platform_contact_public() as value`);
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

type MailSecret = { config: SmtpConfig; cipher: Buffer; enabled: boolean; revision: string; verified_at: string | null };

/**
 * The encrypted SMTP secret for delivery. The app reads it through the identity login (`platform_mail_secret`). The mail
 * delivery process reads it through `ops_mail_secret`, which returns nothing unless central SMTP is enabled. Either way the
 * password stays AES-256-GCM encrypted here and is opened only with SMTP_CONFIG_KEY at the moment of sending.
 */
export async function mailSecret() {
  const { rows } = inMailer()
    ? await (await mailerDatabase()).execute<MailSecret>(sql`select * from public.ops_mail_secret()`)
    : await (await identityDatabase()).execute<MailSecret>(sql`select * from public.platform_mail_secret()`);
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
