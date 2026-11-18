import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { legalUi } from "@/lib/legal";

/** Pure presentational links: safe to import from client components (no server-only code). */

/** Acknowledgement line with links to both documents, for sign-up and onboarding forms. */
export function LegalAcknowledgement({ locale, className }: { locale: Locale; className?: string }) {
  const t = legalUi[locale];
  return <p className={className ?? "text-xs text-muted"}>
    {t.acknowledge} <Link className="font-bold text-brand underline underline-offset-2" href={`/${locale}/terms`}>{t.terms}</Link> {t.and}{" "}
    <Link className="font-bold text-brand underline underline-offset-2" href={`/${locale}/privacy`}>{t.privacy}</Link>{t.end}
  </p>;
}

export function LegalLinks({ locale, className }: { locale: Locale; className?: string }) {
  const t = legalUi[locale];
  return <nav className={className} aria-label={t.legal}>
    <Link href={`/${locale}/terms`}>{t.terms}</Link>
    <Link href={`/${locale}/privacy`}>{t.privacy}</Link>
  </nav>;
}

/** Deep link to the subscription sections of the Terms, for billing screens. */
export function SubscriptionTermsLink({ locale, className }: { locale: Locale; className?: string }) {
  return <Link className={className ?? "font-bold text-brand underline underline-offset-2"} href={`/${locale}/terms#activation`}>{legalUi[locale].subscriptionTerms}</Link>;
}
