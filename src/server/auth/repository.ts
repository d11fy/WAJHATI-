import "server-only";
import { sql } from "drizzle-orm";
import { database, identityDatabase } from "@/server/db/client";
import { authLimits } from "@/server/db/schema";
import { digest, dummyPasswordHash, hashPassword, isSessionToken, randomSessionToken, verifyPassword } from "./crypto";

function newSession() {
  const token = randomSessionToken();
  return { token, expiresAt: new Date(Date.now() + 7 * 86400000) };
}

export async function register(name: string, email: string, password: string, previousToken?: string, signup?: string) {
  const passwordHash = await hashPassword(password);
  const session = newSession();
  const { rows: [result] } = await (await identityDatabase()).execute<{ ok: boolean }>(sql`
    select public.identity_create(${name},${email},${passwordHash},${digest(session.token)},${session.expiresAt.toISOString()}::timestamptz,
      ${previousToken ?? null},${signup ?? null}) as ok
  `);
  return result?.ok ? session : null;
}

export async function passwordCredential(email: string, password: string) {
  const { rows: [credential] } = await (await identityDatabase()).execute<{ id: string; hash: string }>(
    sql`select * from public.identity_password(${email})`);
  const valid = await verifyPassword(password, credential?.hash ?? dummyPasswordHash);
  return valid && credential ? credential : null;
}

export async function authenticate(email: string, password: string, previousToken?: string) {
  const credential = await passwordCredential(email, password);
  if (!credential) return null;
  const session = newSession();
  const { rows: [result] } = await (await identityDatabase()).execute<{ ok: boolean }>(sql`
    select public.identity_sign_in(${credential.id},${credential.hash},${digest(session.token)},${session.expiresAt.toISOString()}::timestamptz,
      ${previousToken ?? null}) as ok
  `);
  return result?.ok ? session : null;
}

export async function getSessionUser(token: string | undefined) {
  if (!isSessionToken(token)) return null;
  const { rows } = await (await database()).execute<{ id: string; name: string; email: string }>(
    sql`select * from public.identity_profile(${token})`);
  return rows[0] ?? null;
}

export async function revokeSession(token: string | undefined) {
  if (isSessionToken(token)) await (await database()).execute(sql`select public.identity_sign_out(${token})`);
}

export async function isVerifiedEmail(token: string | undefined) {
  if (!isSessionToken(token)) return false;
  try {
    const { rows } = await (await database()).execute<{ verified: boolean }>(sql`
      select public.identity_verified(${token}) as verified
    `);
    return rows[0]?.verified === true;
  } catch { throw new Error("Email verification lookup failed."); }
}

export async function consumeLimit(key: string, maximum: number) {
  const expiresAt = sql`now() + interval '15 minutes'`;
  const [row] = await (await database()).insert(authLimits).values({ key: digest(key), attempts: 1, expiresAt })
    .onConflictDoUpdate({
      target: authLimits.key,
      set: {
        attempts: sql`case when ${authLimits.expiresAt} <= now() then 1 else ${authLimits.attempts} + 1 end`,
        expiresAt: sql`case when ${authLimits.expiresAt} <= now() then ${expiresAt} else ${authLimits.expiresAt} end`,
      },
      setWhere: sql`${authLimits.expiresAt} <= now() or ${authLimits.attempts} < ${maximum}`,
    }).returning({ attempts: authLimits.attempts });
  return Boolean(row);
}

export async function allowAuthAttempt(action: "sign-in" | "sign-up", email: string, ip?: string) {
  const signup = action === "sign-up";
  if (ip && !await consumeLimit(`${action}:ip:${ip}`, signup ? 10 : 40)) return false;
  return consumeLimit(`${action}:email:${email}`, signup ? 4 : 8);
}

