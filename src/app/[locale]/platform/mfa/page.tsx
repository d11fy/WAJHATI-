import { notFound } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { MfaForm } from "@/components/platform-forms";
import { copy } from "@/lib/copy";
import { signOut } from "@/server/auth/actions";
import { readSessionToken } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { platformAccess } from "@/server/platform/repository";

export default async function Mfa({ params, searchParams }: PageProps<"/[locale]/platform/mfa">) {
  const locale = await routeLocale(params);
  const access = await platformAccess(await readSessionToken());
  if (!access) notFound();
  const to = (await searchParams).to;
  const target = to === "review" && access.roles.includes("reviewer") ? `/${locale}/payment-review` : `/${locale}/platform`;
  return <AuthShell locale={locale} path={target.endsWith("/payment-review") ? "/platform/mfa?to=review" : "/platform/mfa"}>
    <MfaForm locale={locale} enrolled={access.enrolled} target={target} />
    <form action={signOut.bind(null, locale)} className="mt-5"><button className="button button-secondary">{copy[locale].signOut}</button></form>
  </AuthShell>;
}
