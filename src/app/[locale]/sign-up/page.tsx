import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AuthPage } from "@/components/auth-page";
import { IdentityRequest } from "@/components/identity-forms";
import { AuthShell } from "@/components/auth-shell";
import { registrationAvailable } from "@/lib/billing";
import { copy } from "@/lib/copy";
import { routeLocale } from "@/server/locale";
import { publicSignupEnabled } from "@/server/auth/mail";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-up">): Promise<Metadata> {
  return { title: copy[await routeLocale(params)].signUp, robots: { index: false, follow: false } };
}

export default async function SignUp({ params }: PageProps<"/[locale]/sign-up">) {
  await connection();
  const locale = await routeLocale(params);
  if (registrationAvailable(process.env.APP_ORIGIN, process.env.DAR_LOCAL_SIGNUP)) return <AuthPage locale={locale} mode="sign-up" />;
  if (!(await publicSignupEnabled())) notFound();
  return <AuthShell locale={locale} path="/sign-up">
    <IdentityRequest locale={locale} purpose="signup" />
  </AuthShell>;
}
