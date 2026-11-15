import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { registrationAvailable } from "@/lib/billing";
import { copy } from "@/lib/copy";
import type { Locale } from "@/lib/i18n";
import { publicSignupEnabled } from "@/server/auth/mail";

export async function AuthPage({ locale, mode }: { locale: Locale; mode: "sign-in" | "sign-up" }) {
  const t = copy[locale];
  const signup = mode === "sign-up";
  const ar = locale === "ar";
  const registration = registrationAvailable(process.env.APP_ORIGIN, process.env.DAR_LOCAL_SIGNUP) || (await publicSignupEnabled());
  return (
    <AuthShell locale={locale} path={`/${mode}`}>
      <section>
          <h1>{signup ? (ar ? "ابدأ رحلتك مع واجهتي" : "Start with WAJHATI") : (ar ? "أهلًا بعودتك" : "Welcome back")}</h1>
          <p className="wajhati-auth-intro">{signup ? t.authSignUp : t.authSignIn}</p>
          <AuthForm locale={locale} mode={mode}>
            {!signup && <Link className="wajhati-auth-help" href={`/${locale}/forgot-password`}>{ar ? "استعادة كلمة المرور" : "Forgot your password?"}</Link>}
          </AuthForm>
          {(signup || registration) && <p className="wajhati-auth-alternative">
            {signup ? t.haveAccount : t.noAccount}{" "}
            <Link className="font-bold text-brand underline underline-offset-4" href={`/${locale}/${signup ? "sign-in" : "sign-up"}`}>{signup ? t.signIn : t.signUp}</Link>
          </p>}
      </section>
    </AuthShell>
  );
}
