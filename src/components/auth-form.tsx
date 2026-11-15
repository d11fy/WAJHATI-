"use client";

import { useActionState, useState, type ReactNode } from "react";
import { copy } from "@/lib/copy";
import type { Locale } from "@/lib/i18n";
import { submitAuth } from "@/server/auth/actions";

export function AuthForm({ locale, mode, children }: { locale: Locale; mode: "sign-in" | "sign-up"; children?: ReactNode }) {
  const signup = mode === "sign-up";
  const t = copy[locale];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, action, pending] = useActionState(submitAuth.bind(null, locale, mode), null);

  return (
    <form action={action} className="grid gap-4" aria-busy={pending}>
      {signup && <label className="field">{t.name}
        <input className="control" name="name" autoComplete="name" dir="auto" minLength={2} maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} />
      </label>}
      <label className="field">{t.email}
        <input className="control" name="email" dir="ltr" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">{t.password}
        <input className="control" name="password" dir="ltr" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={12} maxLength={128} required aria-describedby={signup ? "password-hint" : undefined} />
      </label>
      {signup && <p id="password-hint" className="-mt-2 text-xs text-muted">{t.passwordHint}</p>}
      {error && <p role="alert" className="error">{t[error]}</p>}
      {children}
      <button className="button button-primary mt-1" disabled={pending}>{pending ? t.busy : signup ? t.signUp : t.signIn}</button>
    </form>
  );
}
