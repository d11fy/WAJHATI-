import { ArrowRight, CircleCheck, Plus, Store } from "lucide-react";
import Link from "next/link";
import { MerchantWorkspace } from "@/components/workspace-frame";
import { copy } from "@/lib/copy";
import { billingCopy } from "@/lib/billing-copy";
import { readSessionToken, requireUser } from "@/server/auth/session";
import { mayReviewPayments } from "@/server/billing/repository";
import { platformAccess } from "@/server/platform/repository";
import { routeLocale } from "@/server/locale";
import { listMemberStores } from "@/server/stores/repository";

export default async function Dashboard({ params }: PageProps<"/[locale]/dashboard">) {
  const locale = await routeLocale(params);
  const t = copy[locale];
  const user = await requireUser(locale);
  const token = await readSessionToken();
  const [stores, reviewer, platform] = await Promise.all([listMemberStores(user.id), mayReviewPayments(token), platformAccess(token)]);
  const published = stores.filter((store) => store.published).length;
  const format = new Intl.NumberFormat(locale);
  const createPath = `/${locale}/dashboard/new`;
  const account = locale === "ar" ? "أمان الحساب" : "Account security";

  return (
    <MerchantWorkspace locale={locale} path="/dashboard">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-brand" dir="auto">{user.name}</p>
          <h1 className="text-4xl font-black sm:text-5xl">{t.yourStores}</h1>
          <p className="mt-2 text-sm text-muted">{t.dashboardNote}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="button button-secondary lg:hidden" href={`/${locale}/account`}>{account}</Link>
          {platform && <Link className="button button-secondary" href={`/${locale}/platform`}>{locale === "ar" ? "إدارة المنصة" : "Platform administration"}</Link>}
          {reviewer && <Link className="button button-secondary" href={`/${locale}/payment-review`}>{billingCopy[locale].review}</Link>}
          <Link className="button button-primary" href={createPath}><Plus size={18} aria-hidden="true" />{t.createStore}</Link>
        </div>
      </div>
      <dl className="my-6 grid grid-cols-2 gap-3 sm:gap-4">
        {[{ title: t.totalStores, value: stores.length, icon: Store }, { title: t.publicStores, value: published, icon: CircleCheck }].map(({ title, value, icon: Icon }) => (
          <div key={title} className="panel p-4 sm:p-5">
            <span className="icon-tile mb-2"><Icon size={20} aria-hidden="true" /></span>
            <dt className="text-sm font-semibold text-muted">{title}</dt><dd className="text-3xl font-black">{format.format(value)}</dd>
          </div>
        ))}
      </dl>
      {stores.length === 0 ? (
        <section className="panel border-dashed bg-white/60 p-7 text-center sm:p-10">
          <span className="icon-tile mx-auto"><Store size={22} aria-hidden="true" /></span>
          <h2 className="mt-3 text-xl font-black">{t.emptyTitle}</h2><p className="mt-1 text-sm text-muted">{t.emptyDescription}</p>
        </section>
      ) : (
        <ul className="grid gap-3">
          {stores.map((store) => (
            <li key={store.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="icon-tile"><Store size={20} aria-hidden="true" /></span>
                <div className="min-w-0"><h2 className="wrap-anywhere font-extrabold"><bdi>{store.name}</bdi></h2><p className="truncate text-start text-xs text-muted" title={`/${locale}/s/${store.slug}`}><bdi dir="ltr">/{locale}/s/{store.slug}</bdi></p></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="tag">{store.published ? t.publicationEnabled : t.draft}</span>
                <Link className="button button-secondary" href={`/${locale}/dashboard/stores/${store.slug}`}>{t.openStore}<ArrowRight className="arrow" size={16} aria-hidden="true" /></Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </MerchantWorkspace>
  );
}
