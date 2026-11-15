import "server-only";
import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@/lib/i18n";
import { getSessionUser } from "./repository";

function isHttpsOrLocal() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) return true;
  return origin.startsWith("https://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1");
}

const secure = process.env.NODE_ENV === "production" && isHttpsOrLocal();
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
  const h = await headers();
  const raw = h.get(header)?.trim();
  const candidate = raw?.split(",")[0]?.trim();
  if (candidate && isIP(candidate)) return candidate;
  const realIp = h.get("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;
  return undefined;
}
