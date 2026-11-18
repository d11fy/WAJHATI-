import type { Metadata } from "next";
import { MerchantWorkspace } from "@/components/workspace-frame";
import { EmailChange, IdentityRequest } from "@/components/identity-forms";
import { readSessionToken, requireUser } from "@/server/auth/session";
import { isVerifiedEmail } from "@/server/auth/repository";
import { routeLocale } from "@/server/locale";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function Account({ params }: PageProps<"/[locale]/account">) {
  const locale = await routeLocale(params);
  const user = await requireUser(locale);
  const verified = await isVerifiedEmail(await readSessionToken());
  return <MerchantWorkspace locale={locale} path="/account"><div className="grid max-w-3xl gap-4">
    <header><h1 className="mb-2 text-3xl font-black">{locale === "ar" ? "أمان الحساب" : "Account security"}</h1>
      <p className="text-sm font-bold text-brand"><bdi>{user.email}</bdi></p></header>
    {verified ? <p className="tag w-fit">{locale === "ar" ? "البريد موثّق" : "Email verified"}</p>
      : <IdentityRequest locale={locale} purpose="verify" />}
    <EmailChange locale={locale} />
  </div></MerchantWorkspace>;
}
