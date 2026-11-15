import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminWorkspace } from "@/components/admin-workspace";
import {
  AdminMutation,
  ManualSubscriptionForm,
  SmtpSettingsForm,
  type ManagedStoreRecord,
  type ManualTermRecord,
} from "@/components/platform-forms";
import {
  defaultPlatformWhatsapp,
  formatWhatsappPhone,
  transactionalEmailCatalog,
} from "@/lib/platform-contact";
import { platformCopy, areas } from "@/lib/platform-copy";
import type { Locale } from "@/lib/i18n";
import { countries, currencies } from "@/lib/validation";
import { formatPrice, type Currency } from "@/lib/catalog";
import { subscriptionLabels, paymentLabels, setupLabels } from "@/lib/billing-copy";
import type { PaymentStatus, Subscription } from "@/lib/billing";
import { readSessionToken, readUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { configAction, contactAction, roleAction, supportAction } from "@/server/platform/actions";
import type { MailView } from "@/server/platform/contact";
import { platformAccess, platformRows, type PlatformArea, type Role } from "@/server/platform/repository";

type Merchant = {
  id: string;
  name: string;
  email: string;
  createdAt?: string;
  verified: boolean;
  exactEmail?: boolean;
  stores: number;
  trialUsed: boolean;
  trialStartsAt?: string | null;
  trialEndsAt?: string | null;
  roles: Role[];
  managedStores?: ManagedStoreRecord[];
};
type Store = {
  id: string;
  ownerId?: string;
  ownerEmail?: string;
  ownerName?: string;
  name: string;
  slug: string;
  country: string;
  currency?: Currency;
  published: boolean;
  suspended: boolean;
  hold: boolean;
  legacyUntil: string | null;
  billing: Subscription;
  products: number;
  storageBytes: number;
  orders: number;
  theme: string | null;
  updated: string;
  lastBilling: string | null;
  manual?: ManualTermRecord[];
};
type Payment = { id: string; reference: string; store: string; status: PaymentStatus; currency: Currency; amount: number; createdAt: string;
  setup: string | null; setupStatus: string | null; dual: boolean; canReview: boolean };
type Event = { id: number; action: string; subject: string | null; actor: string | null; detail: Record<string, string>; created_at: string; hash: string };
type Job = { id: string; job: string; started_at: string; finished_at: string | null; success: boolean | null; details: Record<string, number> };
type Overview = Record<"merchants" | "stores" | "approved" | "pending" | "suspended" | "legacy" | "setup", number>;
type Plan = { id: string; code: string; name: string; version: number; max_products: number; storage_mib: number; analytics: string; luxury: boolean; premium: boolean };
type Market = { id: string; country: string; currency: Currency; active: boolean; label?: string; amount?: number; interval?: string; plan_id?: string; instructions?: string };
type PlanCatalog = { plans: Plan[]; prices: Market[]; methods: Market[]; setups: Market[] };
type NotificationRecent = {
  id: string;
  kind: string;
  createdAt: string;
  dueAt: string;
  attempts: number;
  sentAt: string | null;
  failedAt: string | null;
};
type Policy = {
  trial_days: number;
  trial_products: number;
  grace_days: number;
  allow_trials: boolean;
  luxury_enabled: boolean;
  admin_may_suspend: boolean;
  dual_thresholds: Record<string, number>;
  contact?: { enabled: boolean; whatsapp: string };
  mail?: MailView | null;
  notificationStats?: { pending: number; sent: number; failed: number; recent: NotificationRecent[] };
};
const roles = ["owner", "administrator", "reviewer"] as const;
const support = ["suspend", "restore", "hold", "release", "end_legacy"] as const;
const reasons = ["security", "abuse", "support", "billing"] as const;
const valueString = (value: unknown) => typeof value === "string" ? value : "";
const statusFilters = {
  merchants: ["verified","unverified"], stores: ["suspended","legacy"], subscriptions: ["trialing","active","pending_payment","grace_period","suspended","canceled","expired","legacy"],
  payments: ["awaiting_payment","submitted","under_review","approved","rejected","expired"], setup: ["awaiting_payment","paid","completed","closed"],
} as Partial<Record<PlatformArea,string[]>>;

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel grid gap-4 p-5"><h2 className="text-xl font-black">{title}</h2>{children}</section>;
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="field">{title}{children}</label>;
}

function Numbers({ title, name, value, minimum = 1 }: { title: string; name: string; value?: number; minimum?: number }) {
  return <Field title={title}><input className="control" type="number" name={name} min={minimum} step={1} required defaultValue={value} /></Field>;
}

function MarketFields({ locale }: { locale: Locale }) {
  const t = platformCopy[locale];
  const regions = new Intl.DisplayNames(locale,{ type:"region" });
  return <div className="grid gap-3 sm:grid-cols-2">
    <Field title={t.country}><select className="control" name="country" required>{countries.map((item) => <option value={item} key={item}>{regions.of(item)}</option>)}</select></Field>
    <Field title={t.currency}><select className="control" name="currency" required>{currencies.map((item) => <option value={item} key={item}>{item}</option>)}</select></Field>
  </div>;
}

function PlanForms({ locale, data }: { locale: Locale; data: PlanCatalog }) {
  const t = platformCopy[locale];
  return <div className="grid gap-4 lg:grid-cols-2">
    <Panel title={t.createPlan}><AdminMutation locale={locale} button={t.createPlan} submitAction={configAction.bind(null,locale,"plan")}>
      <Field title={t.plan}><select className="control" name="code"><option value="starter">Starter</option><option value="pro">Pro</option></select></Field>
      <Field title={t.name}><input className="control" name="name" required maxLength={100} /></Field>
      <Numbers name="version" title={t.version} /><Numbers name="products" title={t.products} /><Numbers name="storage" title={t.storage} minimum={6} />
      <Field title={t.analytics}><select className="control" name="analytics"><option value="basic">Basic</option><option value="enhanced">Enhanced</option></select></Field>
      <label className="flex items-center gap-2"><input type="checkbox" name="luxury" />{t.luxury}</label>
      <label className="flex items-center gap-2"><input type="checkbox" name="premium" />{t.premium}</label>
    </AdminMutation></Panel>
    <Panel title={t.price}><AdminMutation locale={locale} button={t.price} submitAction={configAction.bind(null,locale,"price")}>
      <Field title={t.plan}><select className="control" name="plan">{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.version}</option>)}</select></Field>
      <MarketFields locale={locale} /><Field title={t.interval}><select className="control" name="interval"><option value="monthly">{locale==="ar"?"شهري":"Monthly"}</option><option value="yearly">{locale==="ar"?"سنوي":"Yearly"}</option></select></Field>
      <Numbers name="amount" title={t.amount} />
    </AdminMutation></Panel>
    {(["method","setup"] as const).map((kind) => <Panel title={kind==="method"?t.method:t.setupPackage} key={kind}>
      <AdminMutation locale={locale} button={kind==="method"?t.method:t.setupPackage} submitAction={configAction.bind(null,locale,kind)}>
        <MarketFields locale={locale} /><Field title={t.name}><input name="label" className="control" required maxLength={100} /></Field>
        {kind==="method" ? <Field title={t.instructions}><textarea name="instructions" className="control" required maxLength={1600} rows={3} /></Field>
          : <Numbers name="amount" title={t.amount} />}
      </AdminMutation>
    </Panel>)}
  </div>;
}

function ConfigList({ locale, data, edit }: { locale: Locale; data: PlanCatalog; edit: boolean }) {
  const t = platformCopy[locale];
  return <>
    <Panel title={t.plans}><div className="grid gap-3 sm:grid-cols-2">{data.plans.map((plan) => <article key={plan.id} className="rounded-xl border border-line p-4">
      <h3 className="font-black">{plan.name} · {t.version} {plan.version}</h3>
      <p className="text-sm text-muted">{t.products} {plan.max_products} · {t.storage} {plan.storage_mib} · {plan.analytics}</p>
      <p className="text-sm">{t.luxury} {plan.luxury ? t.yes:t.no} · {t.premium} {plan.premium?t.yes:t.no}</p>
    </article>)}</div></Panel>
    {(["prices","methods","setups"] as const).map((kind) => <Panel key={kind} title={kind==="prices"?t.price:kind==="methods"?t.method:t.setup}>
      {!data[kind].length && <p>{t.empty}</p>}
      <ul className="grid gap-3">{data[kind].map((item) => <li className="rounded-xl border border-line p-4" key={item.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold"><bdi>{item.label ?? data.plans.find((p)=>p.id===item.plan_id)?.name ?? item.interval}</bdi> · <bdi>{item.country} / {item.currency}</bdi>
            {item.amount != null && <> · <bdi>{formatPrice(item.amount,item.currency,locale)}</bdi></>}</span>
          <span className="tag">{item.active?t.active:t.inactive}</span>
        </div>
        {edit && <details className="mt-2"><summary className="cursor-pointer text-sm font-bold text-brand">{t.action}</summary>
          <AdminMutation locale={locale} button={item.active?t.inactive:t.active}
            submitAction={configAction.bind(null,locale,kind==="prices"?"price_active":kind==="methods"?"method_active":"setup_active")}>
            <input type="hidden" name="id" value={item.id} /><input type="hidden" name="active" value={String(!item.active)} />
          </AdminMutation></details>}
      </li>)}</ul>
    </Panel>)}
    {edit && <PlanForms locale={locale} data={data} />}
  </>;
}

function PlatformOverview({ locale, counts, events, jobs, date }: {
  locale: Locale; counts: Overview; events: Event[]; jobs: Job[]; date: (value: string) => string;
}) {
  const t = platformCopy[locale];
  const ar = locale === "ar";
  const number = new Intl.NumberFormat(locale);
  const metrics = [
    [ar ? "الدفعات المعتمدة" : "Approved payments", counts.approved],
    [ar ? "الدفعات قيد المراجعة" : "Payments awaiting review", counts.pending],
    [t.merchants, counts.merchants], [t.stores, counts.stores],
  ] as const;
  const followUp = [
    [t.pending, counts.pending, "/platform/payments"],
    [ar ? "طلبات تجهيز مدفوعة" : "Paid setup requests", counts.setup, "/platform/setup"],
    [t.suspended, counts.suspended, "/platform/stores?status=suspended"],
    [t.legacy, counts.legacy, "/platform/stores?status=legacy"],
  ] as const;
  return <div className="grid gap-5">
    {counts.pending > 0 && <aside className="wajhati-admin-notice">
      <div><p className="font-black">{ar ? "دفعات تحتاج إلى مراجعة" : "Payments awaiting review"}</p>
        <p className="text-sm text-muted">{ar ? "تحتاج الموافقة إلى مطابقة الدفعة مع سجل التحصيل." : "Approval requires matching the payment to the collection record."}</p></div>
      <Link className="button button-secondary shrink-0" href={`/${locale}/platform/payments`}>{t.payments}</Link>
    </aside>}
    <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {metrics.map(([label, value]) => <div className="panel min-w-0 p-4 sm:p-5" key={label}>
        <dt className="text-sm font-bold text-muted">{label}</dt><dd className="mt-1 text-3xl font-black">{number.format(value)}</dd>
      </div>)}
    </dl>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Panel title={ar ? "بحاجة إلى متابعة" : "Needs attention"}><ul className="grid gap-2">
        {followUp.map(([label, value, path]) => <li key={label}>
          <Link className="wajhati-workspace-list-row" href={`/${locale}${path}`}><span>{label}</span><span className="tag">{number.format(value)}</span></Link>
        </li>)}
      </ul></Panel>
      <Panel title={t.jobs}>
        {!jobs.length ? <p className="text-sm text-muted">{t.empty}</p> : <ul className="grid gap-2">
          {jobs.map((job) => <li key={job.id} className="wajhati-workspace-list-row"><bdi className="wrap-anywhere">{job.job}</bdi>
            <span className={`tag ${job.success === false ? "bg-red-50 text-red-800" : job.success === null ? "bg-amber-50 text-amber-900" : ""}`}>
              {job.success === true ? t.successful : job.success === false ? t.failed : t.running}
            </span>
          </li>)}
        </ul>}
        <Link className="text-sm font-bold text-brand underline" href={`/${locale}/platform/jobs`}>{t.jobs}</Link>
      </Panel>
    </div>
    <Panel title={ar ? "آخر الأحداث" : "Recent events"}>
      {!events.length ? <p className="text-sm text-muted">{t.empty}</p> : <ul className="grid gap-2">
        {events.map((event) => <li className="wajhati-workspace-list-row" key={event.id}><bdi className="wrap-anywhere">{event.action}</bdi>
          <time className="text-muted" dateTime={event.created_at}><bdi>{date(event.created_at)} UTC</bdi></time></li>)}
      </ul>}
    </Panel>
  </div>;
}

export default async function PlatformPage({ params,searchParams }: PageProps<"/[locale]/platform/[section]">) {
  const locale=await routeLocale(params);
  const section=(await params).section as PlatformArea;
  if (!areas.includes(section)) notFound();
  const token=await readSessionToken();
  const access=await platformAccess(token);
  if (!access) notFound();
  const manager=access.roles.includes("owner")||access.roles.includes("administrator");
  const owner=access.roles.includes("owner");
  if (!manager && section!=="payments" && section!=="setup") notFound();
  if (!access.elevated) redirect(`/${locale}/platform/mfa`);
  const t=platformCopy[locale];
  const query=await searchParams;
  const search=valueString(query.q).trim().slice(0,100);
  const validFilters=statusFilters[section]??[];
  const filter=validFilters.includes(valueString(query.status))?valueString(query.status):"";
  const page=/^\d{1,4}$/.test(valueString(query.page))?Math.min(1000,Math.max(1,Number(query.page))):1;
  const path=`/${locale}/platform/${section}`;
  const pagination=(number:number)=>`${path}?${new URLSearchParams({q:search,status:filter,page:String(number)})}`;
  const filterLabel=(item:string)=>subscriptionLabels[locale][item as Subscription["status"]]??paymentLabels[locale][item as PaymentStatus]??
    setupLabels[locale][item]??(item==="verified"?t.emailVerified:item==="legacy"?t.legacy:item==="unverified"?(locale==="ar"?"غير موثّق":"Unverified"):item);
  const [rows, latestEvents, latestJobs, merchantMatches, actor] = await Promise.all([
    platformRows<unknown>(token, section, search, page, filter),
    section === "overview" ? platformRows<Event>(token, "audit") : [],
    section === "overview" ? platformRows<Job>(token, "jobs") : [],
    section === "subscriptions" ? platformRows<Merchant>(token, "merchants", search, 1, "") : [],
    readUser(),
  ]);
  const actorId = actor?.id ?? "";
  const actorEmail = actor?.email ?? "";
  const date=(value:string)=>new Intl.DateTimeFormat(locale,{dateStyle:"medium",timeStyle:"short",timeZone:"UTC"}).format(new Date(value));
  const numbers=new Intl.NumberFormat(locale);
  const listing=!["overview","plans","settings"].includes(section);

  return <AdminWorkspace locale={locale} path={`/platform/${section}`} roles={access.roles}>
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-bold text-brand">{access.roles.map((role) => t[role]).join(" · ")}</p>
        <h1 className="text-3xl font-black sm:text-4xl">{section === "overview" ? (locale === "ar" ? "مركز إدارة منصة واجهتي" : "Wajhati platform console") : t[section]}</h1></div>
      {section === "overview" && <Link className="button button-primary" href={`/${locale}/platform/audit`}>{t.audit}</Link>}
    </header>
    {!access.fresh && <p className="panel mb-5 p-4 text-sm text-muted">{t.fresh} <Link className="font-bold text-brand underline" href={`/${locale}/platform/mfa`}>{t.mfa}</Link></p>}
    {listing && <form className="panel mb-4 flex flex-wrap items-end gap-3 p-4" action={path} method="get">
      <Field title={t.search}><input className="control" name="q" type="search" defaultValue={search} maxLength={100} placeholder={section === "merchants" || section === "subscriptions" ? "merchant@example.com" : undefined} /></Field>
      {!!validFilters.length && <Field title={t.filter}><select className="control" name="status" defaultValue={filter}><option value="">{t.all}</option>
        {validFilters.map((item)=><option value={item} key={item}>{filterLabel(item)}</option>)}</select></Field>}
      <button className="button button-primary">{t.search}</button>
    </form>}
    <div className="grid gap-4">
      {listing && !rows.length && !(section === "subscriptions" && merchantMatches.length) && <p className="panel p-5 text-sm">{t.empty}</p>}
      {section==="overview" && rows[0]==null && <p className="panel p-5 text-sm">{t.unavailable}</p>}
      {section==="overview" && rows[0]!=null && <PlatformOverview locale={locale} counts={rows[0] as Overview}
        events={latestEvents.slice(0, 5)} jobs={latestJobs.slice(0, 4)} date={date} />}
      {section === "subscriptions" && !!search && !!merchantMatches.length && <Panel title={t.activationTitle}>
        <p className="text-sm text-muted">{t.activationDesc}</p>
        <div className="grid gap-4">
          {merchantMatches.slice(0, 5).map((merchant) => <div key={merchant.id} className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-black"><bdi>{merchant.name}</bdi> · <bdi>{merchant.email}</bdi></span>
              {merchant.exactEmail && <span className="tag">{t.exactEmailMatch}</span>}
            </div>
            <ManualSubscriptionForm
              locale={locale}
              merchantId={merchant.id}
              merchantEmail={merchant.email}
              stores={merchant.managedStores ?? []}
              trialEndsAt={merchant.trialEndsAt ?? null}
              canActivate={manager && access.fresh}
              actorId={actorId}
            />
          </div>)}
        </div>
      </Panel>}
      {section==="merchants" && (rows.slice(0,20) as Merchant[]).map((row)=><Panel title={row.name} key={row.id}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="wrap-anywhere text-sm font-bold"><bdi>{row.email}</bdi></p>
          {row.exactEmail && <span className="tag">{t.exactEmailMatch}</span>}
        </div>
        <p className="text-sm text-muted">
          {t.emailVerified} {row.verified?t.yes:t.no} · {t.stores} {numbers.format(row.stores)} · {t.trialUsed} {row.trialUsed?t.yes:t.no}
          {row.createdAt && <> · {t.accountCreated} <bdi>{date(row.createdAt)} UTC</bdi></>}
          {row.trialEndsAt && <> · {t.trialWindow}: <bdi>{row.trialStartsAt ? `${date(row.trialStartsAt)} → ` : ""}{date(row.trialEndsAt)} UTC</bdi></>}
        </p>
        {!!row.roles.length && <p className="text-sm font-bold">{row.roles.map((role)=>t[role]).join(" · ")}</p>}
        <ManualSubscriptionForm
          locale={locale}
          merchantId={row.id}
          merchantEmail={row.email}
          stores={row.managedStores ?? []}
          trialEndsAt={row.trialEndsAt ?? null}
          canActivate={manager && access.fresh}
          actorId={actorId}
        />
        {owner && access.fresh && row.verified && <details><summary className="cursor-pointer text-sm font-bold text-brand">{t.role}</summary>
          <AdminMutation locale={locale} button={t.rules} submitAction={roleAction.bind(null,locale,row.id)}>
            <Field title={t.role}><select className="control" name="role">{roles.map((role)=><option key={role} value={role}>{t[role]}</option>)}</select></Field>
            <Field title={t.action}><select className="control" name="operation"><option value="grant">{t.grant}</option><option value="revoke">{t.revoke}</option></select></Field>
          </AdminMutation></details>}
      </Panel>)}
      {(section==="stores"||section==="subscriptions"||section==="themes") && (rows.slice(0,20) as Store[]).map((row)=><Panel title={row.name} key={row.id}>
        <p className="wrap-anywhere text-sm font-bold">
          <bdi>{row.slug}</bdi> · <bdi>{row.country}</bdi> · {row.suspended?t.suspended:row.published?t.visible:t.inactive}
          {row.ownerEmail && <> · <bdi className="text-muted">{row.ownerEmail}</bdi></>}
        </p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">{t.subscriptions}</dt><dd className="font-bold">{row.billing.legacy?t.legacy:subscriptionLabels[locale][row.billing.status]} {row.billing.plan??""}</dd></div>
          <div><dt className="text-muted">{t.products}</dt><dd className="font-bold">{numbers.format(row.products)}</dd></div>
          <div><dt className="text-muted">{t.storage}</dt><dd className="font-bold">{numbers.format(row.storageBytes/1048576)}</dd></div>
          <div><dt className="text-muted">{t.orders}</dt><dd className="font-bold">{numbers.format(row.orders)}</dd></div>
          <div><dt className="text-muted">{t.themes}</dt><dd className="font-bold"><bdi>{row.theme??"minimal-commerce"}</bdi></dd></div>
          <div><dt className="text-muted">{t.date}</dt><dd className="font-bold"><bdi>{date(row.updated)} UTC</bdi></dd></div>
          {row.legacyUntil && <div><dt className="text-muted">{t.legacy}</dt><dd className="font-bold"><bdi>{date(row.legacyUntil)} UTC</bdi></dd></div>}
          {row.billing.periodEnd && <div><dt className="text-muted">{t.interval}</dt><dd className="font-bold"><bdi>{date(row.billing.periodEnd)} UTC</bdi></dd></div>}
        </dl>
        {row.lastBilling && <Link className="text-sm font-bold text-brand underline" href={`/${locale}/platform/payments?q=${encodeURIComponent(row.name)}`}>{t.seeHistory}</Link>}
        {section === "subscriptions" && row.ownerId && <details>
          <summary className="cursor-pointer text-sm font-bold text-brand">{t.activationTitle}</summary>
          <div className="mt-2">
            <ManualSubscriptionForm
              locale={locale}
              merchantId={row.ownerId}
              merchantEmail={row.ownerEmail ?? row.slug}
              trialEndsAt={row.billing.accountTrialEnd ?? null}
              canActivate={manager && access.fresh}
              actorId={actorId}
              initialStoreId={row.id}
              stores={[{
                id: row.id,
                name: row.name,
                slug: row.slug,
                country: row.country,
                currency: row.currency ?? "ILS",
                published: row.published,
                suspended: row.suspended,
                hold: row.hold,
                state: row.billing,
                manual: row.manual ?? [],
              }]}
            />
          </div>
        </details>}
        {section!=="themes" && access.fresh && <details><summary className="cursor-pointer text-sm font-bold text-brand">{t.action}</summary>
          <AdminMutation locale={locale} button={t.rules} submitAction={supportAction.bind(null,locale,row.id)}>
            <Field title={t.action}><select className="control" name="operation">{support.filter((item)=>item==="end_legacy"?row.billing.legacy:
              item==="suspend"?!row.suspended:item==="restore"?row.suspended:item==="hold"?!row.hold:row.hold).map((item)=><option key={item} value={item}>{t[item]}</option>)}</select></Field>
            <Field title={t.reason}><select className="control" name="reason" defaultValue=""><option value="" disabled>{t.reason}</option>
              {reasons.map((reason)=><option value={reason} key={reason}>{t[reason]}</option>)}</select></Field>
          </AdminMutation></details>}
      </Panel>)}
      {(section==="payments"||section==="setup") && !!rows.length && <div className="panel wajhati-admin-table" tabIndex={0} role="region" aria-label={t[section]}>
        <table className="w-full min-w-[36rem] text-start text-sm"><caption className="sr-only">{t[section]}</caption><thead><tr className="border-b border-line">
          {[t.name,t.status,locale==="ar"?"المبلغ":"Amount",t.date,t.action].map((label)=><th scope="col" className="p-3 text-start" key={label}>{label}</th>)}</tr></thead>
          <tbody>{(rows.slice(0,20) as Payment[]).map((row)=><tr className="border-b border-line last:border-0" key={row.id}>
            <td className="p-3"><bdi className="font-bold">{row.reference}</bdi><br /><bdi>{row.store}</bdi>{row.setup&&<p>{row.setup}</p>}</td>
            <td className="p-3">{section==="setup"&&row.setupStatus?setupLabels[locale][row.setupStatus]:paymentLabels[locale][row.status]}
              {row.dual&&row.status==="under_review"&&<p className="text-muted">{t.dualPending}</p>}</td>
            <td className="p-3"><bdi>{formatPrice(row.amount,row.currency,locale)}</bdi></td><td className="p-3"><bdi>{date(row.createdAt)} UTC</bdi></td>
            <td className="p-3">{row.canReview&&<Link className="font-bold text-brand underline" href={`/${locale}/payment-review/${row.id}`}>{t.openReview}</Link>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {section==="plans"&&rows[0]!=null&&<ConfigList locale={locale} data={rows[0] as PlanCatalog} edit={owner&&access.fresh} />}
      {section==="settings"&&rows[0]!=null&&(()=>{
        const policy=rows[0] as Policy;
        const whatsappPhone = formatWhatsappPhone(policy.contact?.whatsapp ?? defaultPlatformWhatsapp);
        const whatsappEnabled = policy.contact?.enabled ?? true;
        return <>
          <Panel title={t.configuration}>
            {owner&&access.fresh?<AdminMutation locale={locale} button={t.rules} submitAction={configAction.bind(null,locale,"rules")}>
              <div className="grid gap-3 sm:grid-cols-3"><Numbers name="trialDays" title={t.trialDays} value={policy.trial_days} />
                <Numbers name="trialProducts" title={t.trialProducts} value={policy.trial_products} /><Numbers name="graceDays" title={t.graceDays} value={policy.grace_days} minimum={0} /></div>
              <label className="flex items-center gap-2"><input type="checkbox" name="allowTrials" defaultChecked={policy.allow_trials} />{t.allowTrials}</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="luxury" defaultChecked={policy.luxury_enabled} />{t.luxury}</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="adminMaySuspend" defaultChecked={policy.admin_may_suspend} />{t.adminMaySuspend}</label>
              <Field title={t.dual}><textarea className="control" name="dual" dir="ltr" rows={3} maxLength={1000} defaultValue={JSON.stringify(policy.dual_thresholds,null,2)} /></Field>
            </AdminMutation>:<p className="text-sm">{t.trialDays} {policy.trial_days} · {t.trialProducts} {policy.trial_products} · {t.graceDays} {policy.grace_days}</p>}
          </Panel>

          <Panel title={t.whatsappSettingsTitle}>
            <p className="text-sm text-muted">
              {locale === "ar"
                ? `الرقم الرسمي الحالي لتفعيل وتجديد الاشتراكات: ${whatsappPhone}`
                : `Current official WhatsApp number for subscription activation & renewal: ${whatsappPhone}`}
            </p>
            {owner && access.fresh ? (
              <AdminMutation locale={locale} button={t.saveWhatsapp} confirmLabel={t.confirmWhatsapp} submitAction={contactAction.bind(null, locale)}>
                <Field title={t.whatsappPhone}>
                  <input className="control" name="whatsapp" dir="ltr" required defaultValue={whatsappPhone} placeholder="+972567508786" />
                </Field>
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input className="accent-brand" type="checkbox" name="contactEnabled" defaultChecked={whatsappEnabled} />
                  {t.whatsappEnabled}
                </label>
              </AdminMutation>
            ) : (
              <p className="text-sm font-bold"><bdi>{whatsappPhone}</bdi> · {whatsappEnabled ? t.active : t.inactive}</p>
            )}
          </Panel>

          {owner && (
            <Panel title={t.smtpTitle}>
              <SmtpSettingsForm locale={locale} mail={policy.mail ?? null} canEdit={owner && access.fresh} defaultRecipient={actorEmail} />
            </Panel>
          )}

          <Panel title={t.emailTemplatesTitle}>
            <div className="grid gap-3 sm:grid-cols-2">
              {transactionalEmailCatalog.map((item) => (
                <article key={item.id} className="rounded-xl border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-black">{locale === "ar" ? item.subjectAr : item.subjectEn}</h3>
                    <code className="text-xs text-muted" dir="ltr">{item.id}</code>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-brand">{locale === "ar" ? item.triggerAr : item.triggerEn}</p>
                  <p className="mt-1 text-xs text-muted">{locale === "ar" ? item.summaryAr : item.summaryEn}</p>
                </article>
              ))}
            </div>
          </Panel>

          {policy.notificationStats && (
            <Panel title={t.notificationHealthTitle}>
              <dl className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-xl bg-leaf p-3"><dt className="text-xs text-muted">{t.queuePending}</dt><dd className="mt-1 text-2xl font-black">{numbers.format(policy.notificationStats.pending)}</dd></div>
                <div className="rounded-xl bg-leaf p-3"><dt className="text-xs text-muted">{t.queueSent}</dt><dd className="mt-1 text-2xl font-black">{numbers.format(policy.notificationStats.sent)}</dd></div>
                <div className="rounded-xl bg-leaf p-3"><dt className="text-xs text-muted">{t.queueFailed}</dt><dd className="mt-1 text-2xl font-black">{numbers.format(policy.notificationStats.failed)}</dd></div>
              </dl>
              {!!policy.notificationStats.recent?.length && (
                <ul className="grid gap-2 text-xs">
                  {policy.notificationStats.recent.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3">
                      <span><strong dir="ltr">{item.kind}</strong> · <bdi>{date(item.createdAt)} UTC</bdi></span>
                      <span className="tag">{item.sentAt ? t.queueSent : item.failedAt ? t.queueFailed : t.queuePending} ({item.attempts})</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </>;
      })()}
      {section==="audit" && (rows.slice(0,20) as Event[]).map((row)=><Panel key={row.id} title={row.action}><p className="text-sm"><bdi>{date(row.created_at)} UTC</bdi></p>
        <p className="wrap-anywhere font-mono text-xs text-muted" dir="ltr">#{row.id} · {row.actor??"system"} · {row.subject??"—"} · {JSON.stringify(row.detail)} · {row.hash}</p></Panel>)}
      {section==="jobs" && (rows.slice(0,20) as Job[]).map((row)=><Panel key={row.id} title={row.job}>
        <p className="text-sm font-bold">{row.success===true?t.successful:row.success===false?t.failed:t.running}</p>
        <p className="wrap-anywhere text-sm"><bdi>{date(row.started_at)} UTC</bdi>{row.finished_at&&<> · <bdi>{date(row.finished_at)} UTC</bdi></>}</p>
        <bdi className="text-xs text-muted">{JSON.stringify(row.details)}</bdi>
      </Panel>)}
    </div>
    {listing&&<nav className="mt-5 flex gap-2" aria-label={t.details}>
      {page>1&&<Link className="button button-secondary" href={pagination(page-1)}>{t.previous}</Link>}
      {rows.length>20&&page<1000&&<Link className="button button-secondary" href={pagination(page+1)}>{t.next}</Link>}
    </nav>}
  </AdminWorkspace>;
}
