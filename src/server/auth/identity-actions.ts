"use server";

import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { isLocale } from "@/lib/i18n";
import { signUpInput } from "@/lib/validation";
import { clearSessionCookie, readSessionToken, readUser, requireUser, setSessionCookie, trustedClientIp } from "./session";
import { consumeLimit, register } from "./repository";
import { identityPurposes, issueEmailChange, issueIdentity, tokenEmail, consumeIdentity, type IdentityPurpose } from "./identity";
import { mailProvider, publicSignupEnabled, sendIdentityMail } from "./mail";
import { reportOperationalError } from "@/server/ops/report";

export type IdentityState = "sent" | "ok" | "pending" | "invalid" | "unavailable" | null;
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const password = z.string().min(12).max(128);
const eventFailure = () => reportOperationalError("identity_mail_failed", "identity");

export async function requestIdentity(locale: string, purpose: "signup" | "reset" | "verify", _previous: IdentityState, form: FormData): Promise<IdentityState> {
  if (!isLocale(locale) || !["signup","reset","verify"].includes(purpose)) notFound();
  if (!(await mailProvider()) || (purpose === "signup" && !(await publicSignupEnabled()))) return "unavailable";
  const session = purpose === "verify" ? await readSessionToken() : undefined;
  const user = purpose === "verify" ? await readUser() : null;
  const address = email.safeParse(user?.email ?? form.get("email"));
  const ip = await trustedClientIp();
  if (!address.success || (purpose === "verify" && !user)) return "sent";
  try {
    if (ip && !await consumeLimit(`identity:${purpose}:ip:${ip}`, 15)) return "sent";
    if (!await consumeLimit(`identity:${purpose}:address:${address.data}`, 3)) return "sent";
  } catch { return "unavailable"; }
  after(async () => {
    try {
      const token = await issueIdentity(purpose, address.data, session);
      if (token) await sendIdentityMail(locale, address.data, purpose, token);
    } catch { await eventFailure(); }
  });
  return "sent";
}

export async function confirmIdentity(locale: string, purpose: IdentityPurpose, _previous: IdentityState, form: FormData): Promise<IdentityState> {
  if (!isLocale(locale) || !identityPurposes.includes(purpose)) notFound();
  const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/).safeParse(form.get("token"));
  if (!token.success) return "invalid";
  const ip = await trustedClientIp();
  try {
    if (ip && !await consumeLimit(`identity:confirm:ip:${ip}`, 30)) return "invalid";
    if (!await consumeLimit(`identity:confirm:token:${token.data}`, 6)) return "invalid";
    if (purpose === "signup") {
      if (!(await publicSignupEnabled())) return "unavailable";
      const address = await tokenEmail(token.data, purpose);
      const input = signUpInput.safeParse({ email: address, name: form.get("name"), password: form.get("password") });
      if (!input.success) return "invalid";
      const session = await register(input.data.name, input.data.email, input.data.password, await readSessionToken(), token.data);
      if (!session) return "invalid";
      await setSessionCookie(session.token, session.expiresAt);
    } else {
      const selected = purpose === "reset" ? password.safeParse(form.get("password")) : undefined;
      if (selected && !selected.success) return "invalid";
      const result = await consumeIdentity(token.data, purpose, selected?.data);
      if (result !== "ok") return result;
      if (purpose !== "verify") await clearSessionCookie();
      return "ok";
    }
  } catch { return "unavailable"; }
  redirect(`/${locale}/dashboard`);
}

export async function changeEmail(locale: string, _previous: IdentityState, form: FormData): Promise<IdentityState> {
  if (!isLocale(locale)) notFound();
  if (!(await mailProvider())) return "unavailable";
  const user = await requireUser(locale);
  const session = await readSessionToken();
  const target = email.safeParse(form.get("email"));
  const credential = password.safeParse(form.get("password"));
  if (!session || !target.success || !credential.success) return "invalid";
  try {
    if (!await consumeLimit(`identity:change:${user.id}`, 4)) return "invalid";
    const request = await issueEmailChange(session, user.email, credential.data, target.data);
    if (!request) return "sent";
    after(async () => {
      const deliveries = await Promise.allSettled([sendIdentityMail(locale, request.oldEmail, "change_old", request.before),
        sendIdentityMail(locale, target.data, "change_new", request.after)]);
      if (deliveries.some((entry) => entry.status === "rejected")) await eventFailure();
    });
    return "sent";
  } catch { return "unavailable"; }
}

