import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import shield from "@/assets/wajhati/shield.svg";
import { IdentityConfirm } from "@/components/identity-forms";
import { identityPurposes, type IdentityPurpose } from "@/server/auth/identity";
import { routeLocale } from "@/server/locale";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function IdentityPage({ params }: PageProps<"/[locale]/identity/[purpose]">) {
  const locale = await routeLocale(params);
  const purpose = (await params).purpose as IdentityPurpose;
  if (!identityPurposes.includes(purpose)) notFound();
  return <AuthShell locale={locale} path={`/identity/${purpose}`}>
    <IdentityConfirm locale={locale} purpose={purpose}>
      {purpose === "verify" && <span className="icon-tile"><Image src={shield} alt="" unoptimized /></span>}
    </IdentityConfirm>
  </AuthShell>;
}
