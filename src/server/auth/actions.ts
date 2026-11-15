"use server";

import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { authInput } from "@/lib/validation";
import { registrationAvailable } from "@/lib/billing";
import { reportOperationalError } from "@/server/ops/report";
import { allowAuthAttempt, authenticate, register, revokeSession } from "./repository";
import { clearSessionCookie, readSessionToken, setSessionCookie, trustedClientIp } from "./session";

export type AuthError = "invalid" | "limited" | "invalidCredentials" | "signupUnavailable";

export async function submitAuth(locale: string, mode: "sign-in" | "sign-up", _state: AuthError | null, form: FormData): Promise<AuthError> {
  if (!isLocale(locale) || (mode !== "sign-in" && mode !== "sign-up")) notFound();
  if (mode === "sign-up" && !registrationAvailable(process.env.APP_ORIGIN, process.env.DAR_LOCAL_SIGNUP)) return "signupUnavailable";
  const input = authInput.safeParse({ mode, name: form.get("name"), email: form.get("email"), password: form.get("password") });
  if (!input.success) return "invalid";

  const { email, password } = input.data;
  const ip = await trustedClientIp();
  let session;
  try {
    if (!await allowAuthAttempt(mode, email, ip)) {
      void reportOperationalError("auth_rate_limited", "authentication");
      return "limited";
    }
    const previousToken = await readSessionToken();
    session = input.data.mode === "sign-up"
      ? await register(input.data.name, email, password, previousToken)
      : await authenticate(email, password, previousToken);
  } catch {
    // Database errors can contain query parameters. Keep them out of request logs.
    throw new Error("Authentication service failed.");
  }
  if (!session) return mode === "sign-up" ? "signupUnavailable" : "invalidCredentials";

  await setSessionCookie(session.token, session.expiresAt);
  redirect(`/${locale}/dashboard`);
}

export async function signOut(locale: string) {
  if (!isLocale(locale)) notFound();
  try {
    await revokeSession(await readSessionToken());
  } catch {
    throw new Error("Session revocation failed.");
  }
  await clearSessionCookie();
  redirect(`/${locale}/sign-in`);
}
