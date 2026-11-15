import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { readSessionToken } from "@/server/auth/session";
import { mayReviewPayments } from "@/server/billing/repository";
import { platformAccess } from "@/server/platform/repository";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PaymentReviewLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const token = await readSessionToken();
  if (!await mayReviewPayments(token)) {
    if ((await platformAccess(token))?.roles.includes("reviewer")) {
      const { locale } = await params;
      redirect(`/${locale}/platform/mfa?to=review`);
    }
    notFound();
  }
  return children;
}
