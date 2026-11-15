import "server-only";
import { sql } from "drizzle-orm";
import { identityDatabase } from "@/server/db/client";
import { digest, hashPassword, isSessionToken, randomSessionToken } from "./crypto";
import { passwordCredential } from "./repository";

export const identityPurposes = ["signup", "verify", "reset", "change_old", "change_new"] as const;
export type IdentityPurpose = typeof identityPurposes[number];

export async function issueIdentity(purpose: "signup" | "verify" | "reset", email: string, session?: string) {
  const token = randomSessionToken();
  const { rows: [result] } = await (await identityDatabase()).execute<{ ok: boolean }>(sql`
    select public.identity_issue(${purpose},${email},${session ?? null},${digest(token)}) as ok
  `);
  return result?.ok ? token : null;
}

export async function tokenEmail(token: string, purpose: IdentityPurpose) {
  if (!isSessionToken(token)) return null;
  const { rows: [result] } = await (await identityDatabase()).execute<{ email: string | null }>(sql`
    select public.identity_token_email(${token},${purpose}) as email
  `);
  return result?.email ?? null;
}

export async function consumeIdentity(token: string, purpose: Exclude<IdentityPurpose, "signup">, password?: string) {
  if (!isSessionToken(token)) return "invalid";
  const hash = password ? await hashPassword(password) : null;
  const { rows: [result] } = await (await identityDatabase()).execute<{ status: "ok" | "pending" | "invalid" }>(sql`
    select public.identity_use(${token},${purpose},${hash}) as status
  `);
  return result?.status ?? "invalid";
}

export async function issueEmailChange(token: string, email: string, password: string, target: string) {
  const credential = await passwordCredential(email, password);
  if (!credential) return null;
  const before = randomSessionToken();
  const after = randomSessionToken();
  const { rows: [result] } = await (await identityDatabase()).execute<{ email: string | null }>(sql`
    select public.identity_change(${token},${credential.hash},${target},${digest(before)},${digest(after)}) as email
  `);
  return result?.email ? { oldEmail: result.email, before, after } : null;
}

