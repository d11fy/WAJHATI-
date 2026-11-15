import type { ReactNode } from "react";
import { WorkspaceFrame, type WorkspaceLink } from "@/components/workspace-frame";
import type { Locale } from "@/lib/i18n";
import { areas, platformCopy } from "@/lib/platform-copy";
import type { Role } from "@/server/platform/repository";
import home from "@/assets/wajhati/admin-home.svg";
import users from "@/assets/wajhati/admin-users.svg";
import store from "@/assets/wajhati/admin-store.svg";
import credit from "@/assets/wajhati/admin-credit.svg";
import chart from "@/assets/wajhati/admin-chart.svg";
import clock from "@/assets/wajhati/admin-clock.svg";
import shield from "@/assets/wajhati/admin-shield.svg";
import settings from "@/assets/wajhati/admin-settings.svg";

const icons = {
  overview: home, merchants: users, stores: store, subscriptions: chart, plans: chart,
  payments: credit, setup: clock, themes: store, audit: shield, jobs: clock, settings,
};

export function AdminWorkspace({ locale, path, roles, children }: {
  locale: Locale; path: string; roles: Role[]; children: ReactNode;
}) {
  const t = platformCopy[locale];
  const manager = roles.includes("owner") || roles.includes("administrator");
  const links: WorkspaceLink[] = areas
    .filter((area) => manager || area === "payments" || area === "setup")
    .map((area) => ({ path: `/platform/${area}`, label: t[area], icon: icons[area] }));
  if (roles.includes("reviewer")) links.push({ path: "/payment-review", label: t.review, icon: credit });
  links.push({ path: "/dashboard", label: locale === "ar" ? "لوحة التاجر" : "Merchant dashboard", icon: home, exact: true });
  return <WorkspaceFrame locale={locale} path={path} title={t.title} links={links}>{children}</WorkspaceFrame>;
}
