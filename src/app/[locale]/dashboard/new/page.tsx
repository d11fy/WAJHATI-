import { DashboardFrame } from "@/components/dashboard-frame";
import { StoreWizard } from "@/components/store-wizard";
import { labels } from "@/lib/i18n";
import { countries, currencies } from "@/lib/validation";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";

export default async function NewStore({ params }: PageProps<"/[locale]/dashboard/new">) {
  const locale = await routeLocale(params);
  await requireUser(locale);
  return (
    <DashboardFrame locale={locale} path="/dashboard/new">
      <StoreWizard locale={locale} countries={labels(locale, "region", countries)} currencies={labels(locale, "currency", currencies)} />
    </DashboardFrame>
  );
}
