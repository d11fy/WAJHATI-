import "server-only";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { getSessionUser } from "./repository";

const secure = process.env.NODE_ENV === "production";
const sessionCookie = secure ? "__Host-dar_session" : "dar_session";
const cookieOptions = { httpOnly: true, secure, sameSite: "lax", path: "/" } as const;

export async function readSessionToken() {
  return (await cookies()).get(sessionCookie)?.value;
}

export async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(sessionCookie, token, { ...cookieOptions, expires });
}

export async function clearSessionCookie() {
  (await cookies()).set(sessionCookie, "", { ...cookieOptions, maxAge: 0 });
}

export async function readUser() {
  return getSessionUser(await readSessionToken()).catch(() => {
    throw new Error("Session lookup failed.");
  });
}

export async function requireUser(locale: Locale) {
  const user = await readUser();
  if (!user) redirect(`/${locale}/sign-in`);
  return user;
}

export async function trustedClientIp() {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER;
  if (!header) return undefined;
  const value = (await headers()).get(header)?.trim();
  if (!value || !isIP(value)) throw new Error("The trusted client IP header must contain a single IP address.");
  return value;
}
