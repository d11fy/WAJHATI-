import { notFound, redirect } from "next/navigation";
import { readSessionToken } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { platformAccess } from "@/server/platform/repository";

export default async function PlatformIndex({ params }: PageProps<"/[locale]/platform">) {
  const locale = await routeLocale(params);
  const access = await platformAccess(await readSessionToken());
  if (!access) notFound();
  if (!access.elevated) redirect(`/${locale}/platform/mfa`);
  redirect(`/${locale}/platform/${access.roles.some((role) => role !== "reviewer") ? "overview" : "payments"}`);
}
