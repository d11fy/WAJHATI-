import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import mail from "@/assets/wajhati/mail.svg";
import { copy } from "@/lib/copy";
import { IdentityRequest } from "@/components/identity-forms";
import { routeLocale } from "@/server/locale";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ForgotPassword({ params }: PageProps<"/[locale]/forgot-password">) {
  const locale = await routeLocale(params);
  return <AuthShell locale={locale} path="/forgot-password">
    <IdentityRequest locale={locale} purpose="reset">
      <p className="text-muted">{locale === "ar" ? "سنرسل رابط استعادة آمنًا إلى بريدك إذا كان الطلب مؤهلًا." : "We’ll send a secure recovery link if your request is eligible."}</p>
      <span className="icon-tile"><Image src={mail} alt="" unoptimized /></span>
    </IdentityRequest>
    <p className="wajhati-auth-alternative"><Link className="text-brand" href={`/${locale}/sign-in`}>{copy[locale].signIn}</Link></p>
  </AuthShell>;
}
