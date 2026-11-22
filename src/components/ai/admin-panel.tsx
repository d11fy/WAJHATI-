import type { ReactNode } from "react";
import { AdminMutation } from "@/components/platform-forms";
import { aiOperations, type AiOperation } from "@/lib/ai/fields";
import type { Locale } from "@/lib/i18n";
import { aiAdjustAction, aiConfigAction } from "@/server/ai/admin-actions";
import type { AiAdminOverview } from "@/server/ai/admin";

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel grid gap-4 p-5"><h2 className="text-xl font-black">{title}</h2>{children}</section>;
}
function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="field">{title}{children}</label>;
}

const operationNames: Record<AiOperation, { ar: string; en: string }> = {
  headline: { ar: "عنوان أو عبارة قصيرة (وتحسينها واختصارها وترجمتها)", en: "Short headline or phrase (also improve, shorten, translate)" },
  product_description: { ar: "وصف منتج", en: "Product description" },
  section_description: { ar: "وصف قسم أو مجموعة", en: "Section or collection description" },
  about_store: { ar: "نبذة عن المتجر", en: "About the store" },
  theme_fill: { ar: "تجهيز النصوص الأساسية للثيم", en: "Fill core theme text" },
  store_from_idea: { ar: "بناء محتوى المتجر من فكرة", en: "Build store content from an idea" },
};

/** Administrator view of WAJHATI AI: usage and cost, limits and kill switch, prices, per-store suspension and manual credit grants. Writes are owner/admin + fresh MFA only (enforced in the database). */
export function AiAdminPanel({ locale, data, manage, owner }: { locale: Locale; data: AiAdminOverview; manage: boolean; owner: boolean }) {
  const ar = locale === "ar";
  const n = new Intl.NumberFormat(locale);
  const usd = (value: number | string) => `$${Number(value).toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  const { settings, totals, granted } = data;
  const metrics: [string, string][] = [
    [ar ? "الطلبات (30 يومًا)" : "Requests (30 days)", n.format(totals.requests)],
    [ar ? "الناجحة" : "Succeeded", n.format(totals.succeeded)],
    [ar ? "الفاشلة" : "Failed", n.format(totals.failed)],
    [ar ? "رموز الإدخال" : "Input tokens", n.format(totals.inputTokens)],
    [ar ? "رموز الإخراج" : "Output tokens", n.format(totals.outputTokens)],
    [ar ? "التكلفة التقديرية" : "Estimated cost", usd(totals.costUsd)],
    [ar ? "الأرصدة المستهلكة" : "Credits consumed", n.format(totals.consumed)],
    [ar ? "أرصدة موزعة (دورات)" : "Credits allocated (cycles)", n.format(granted.allocated)],
    [ar ? "منح يدوي" : "Manual grants", n.format(granted.adminGranted)],
    [ar ? "سحب يدوي" : "Manual withdrawals", n.format(granted.adminWithdrawn)],
  ];
  return <div className="grid gap-5">
    <p className={`panel p-4 text-sm font-bold ${settings.enabled ? "" : "border-red-300 bg-red-50 text-red-900"}`} role="status">
      {settings.enabled ? (ar ? "المساعد يعمل." : "The assistant is on.") : (ar ? "مفتاح الإيقاف الشامل مفعّل: المساعد متوقف لكل المتاجر." : "Global kill switch is on: the assistant is off for every store.")}
    </p>
    <Panel title={ar ? "الاستخدام والتكلفة" : "Usage and cost"}>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {metrics.map(([label, value]) => <div key={label} className="rounded-xl bg-leaf p-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 text-lg font-black"><bdi>{value}</bdi></dd></div>)}
      </dl>
      <p className="text-xs text-muted">{ar ? "التكلفة تقدير من عدد الرموز وأسعار المليون رمز أدناه، وليست فاتورة المزوّد." : "Cost is estimated from token counts and the per-million prices below; it is not the provider invoice."}</p>
    </Panel>
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={ar ? "أكثر المتاجر استهلاكًا" : "Top stores by usage"}>
        {!data.top.length ? <p className="text-sm text-muted">{ar ? "لا بيانات بعد." : "No data yet."}</p> : <ul className="grid gap-2 text-sm">
          {data.top.map((row) => <li key={row.slug} className="wajhati-workspace-list-row"><bdi className="font-bold">{row.slug}</bdi>
            <span className="text-muted"><bdi>{n.format(row.consumed)}</bdi> {ar ? "رصيد" : "credits"} · <bdi>{n.format(row.requests)}</bdi> {ar ? "طلب" : "req"} · <bdi>{usd(row.costUsd)}</bdi></span></li>)}
        </ul>}
      </Panel>
      <Panel title={ar ? "آخر الإخفاقات" : "Recent failures"}>
        {!data.failures.length ? <p className="text-sm text-muted">{ar ? "لا إخفاقات." : "No failures."}</p> : <ul className="grid gap-2 text-sm">
          {data.failures.map((row, index) => <li key={index} className="wajhati-workspace-list-row"><bdi className="font-bold">{row.store}</bdi>
            <span className="text-muted"><bdi>{row.operation}</bdi> · <bdi>{row.error ?? "—"}</bdi> · <bdi>{date(row.at)} UTC</bdi></span></li>)}
        </ul>}
      </Panel>
    </div>
    <Panel title={ar ? "الإعدادات والحدود" : "Settings and limits"}>
      {owner && manage ? <AdminMutation locale={locale} button={ar ? "حفظ الإعدادات" : "Save settings"} submitAction={aiConfigAction.bind(null, locale, "settings")}>
        <label className="flex items-center gap-2 font-bold"><input className="accent-brand" type="checkbox" name="enabled" defaultChecked={settings.enabled} />{ar ? "المساعد مفعّل (أزل التحديد لإيقاف شامل)" : "Assistant enabled (clear to switch everything off)"}</label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field title={ar ? "حد الطلبات بالدقيقة لكل متجر" : "Requests per minute per store"}><input className="control" type="number" name="perMinute" min={1} max={600} required defaultValue={settings.per_minute} /></Field>
          <Field title={ar ? "حد الطلبات باليوم لكل متجر" : "Requests per day per store"}><input className="control" type="number" name="perDay" min={1} max={100000} required defaultValue={settings.per_day} /></Field>
          <Field title={ar ? "رصيد التجربة المجانية" : "Free trial credits"}><input className="control" type="number" name="trialCredits" min={0} max={100000} required defaultValue={settings.trial_credits} /></Field>
          <Field title={ar ? "رصيد الشهر للاشتراك الفعّال" : "Monthly credits, active subscription"}><input className="control" type="number" name="monthlyCredits" min={0} max={1000000} required defaultValue={settings.monthly_credits} /></Field>
          <Field title={ar ? "سعر مليون رمز إدخال (دولار)" : "USD per million input tokens"}><input className="control" type="number" step="0.0001" min={0} max={1000} name="usdInput" required defaultValue={settings.usd_per_million_input} /></Field>
          <Field title={ar ? "سعر مليون رمز إخراج (دولار)" : "USD per million output tokens"}><input className="control" type="number" step="0.0001" min={0} max={1000} name="usdOutput" required defaultValue={settings.usd_per_million_output} /></Field>
        </div>
        <p className="text-xs text-muted">{ar ? "تغيير الأرصدة الشهرية يسري على الدورات الجديدة فقط ولا يغيّر ما مُنح." : "Changing the credit amounts applies to new cycles only; credits already granted are unchanged."}</p>
      </AdminMutation>
        : <p className="text-sm">{ar ? "الحد بالدقيقة" : "Per minute"} {settings.per_minute} · {ar ? "باليوم" : "per day"} {settings.per_day} · {ar ? "تجربة" : "trial"} {settings.trial_credits} · {ar ? "شهري" : "monthly"} {settings.monthly_credits}</p>}
    </Panel>
    <Panel title={ar ? "أسعار العمليات (بالأرصدة)" : "Operation prices (credits)"}>
      <ul className="grid gap-3">
        {aiOperations.map((operation) => {
          const row = data.costs.find((item) => item.operation === operation);
          if (!row) return null;
          return <li key={operation} className="rounded-xl border border-line p-3">
            <p className="font-bold">{operationNames[operation][locale]} <code className="text-xs text-muted" dir="ltr">{operation}</code></p>
            {manage && owner ? <AdminMutation locale={locale} button={ar ? "حفظ" : "Save"} submitAction={aiConfigAction.bind(null, locale, "cost")}>
              <input type="hidden" name="operation" value={operation} />
              <div className="flex flex-wrap items-end gap-3">
                <Field title={ar ? "السعر" : "Price"}><input className="control w-28" type="number" name="credits" min={0} max={1000} required defaultValue={row.credits} /></Field>
                <label className="flex min-h-12 items-center gap-2"><input className="accent-brand" type="checkbox" name="active" defaultChecked={row.active} />{ar ? "مفعّلة" : "Active"}</label>
              </div>
            </AdminMutation> : <p className="text-sm">{row.credits} · {row.active ? (ar ? "مفعّلة" : "Active") : (ar ? "متوقفة" : "Off")}</p>}
          </li>;
        })}
      </ul>
    </Panel>
    {manage && <div className="grid gap-5 lg:grid-cols-2">
      <Panel title={ar ? "إيقاف أو تفعيل متجر" : "Suspend or restore a store"}>
        <AdminMutation locale={locale} button={ar ? "تنفيذ" : "Apply"} submitAction={aiConfigAction.bind(null, locale, "store_suspend")}>
          <Field title={ar ? "معرّف المتجر (slug)" : "Store slug"}><input className="control" name="slug" dir="ltr" required minLength={3} maxLength={48} /></Field>
          <Field title={ar ? "الإجراء" : "Action"}><select className="control" name="suspended"><option value="true">{ar ? "إيقاف المساعد لهذا المتجر" : "Suspend AI for this store"}</option><option value="false">{ar ? "إعادة التفعيل" : "Restore"}</option></select></Field>
          <Field title={ar ? "السبب" : "Reason"}><input className="control" name="reason" maxLength={300} /></Field>
        </AdminMutation>
        {!!data.suspended.length && <ul className="grid gap-1 text-sm">{data.suspended.map((row) => <li key={row.slug}><bdi className="font-bold">{row.slug}</bdi>{row.reason && <> · <bdi className="text-muted">{row.reason}</bdi></>}</li>)}</ul>}
      </Panel>
      <Panel title={ar ? "منح أو سحب رصيد يدويًا" : "Manual credit grant or withdrawal"}>
        <AdminMutation locale={locale} button={ar ? "تنفيذ" : "Apply"} submitAction={aiAdjustAction.bind(null, locale)}>
          <Field title={ar ? "معرّف المتجر (slug)" : "Store slug"}><input className="control" name="slug" dir="ltr" required minLength={3} maxLength={48} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title={ar ? "العملية" : "Operation"}><select className="control" name="direction"><option value="grant">{ar ? "منح" : "Grant"}</option><option value="withdraw">{ar ? "سحب" : "Withdraw"}</option></select></Field>
            <Field title={ar ? "عدد الأرصدة" : "Credits"}><input className="control" type="number" name="amount" min={1} max={100000} required /></Field>
          </div>
          <Field title={ar ? "السبب (يُسجَّل في السجل)" : "Reason (written to the ledger)"}><input className="control" name="note" required minLength={3} maxLength={300} /></Field>
          <p className="text-xs text-muted">{ar ? "المنح رصيد إضافي بلا انتهاء. كل عملية تُسجَّل في دفتر الأرصدة وسجل التدقيق." : "Grants are non-expiring extra credit. Every change is written to the credit ledger and the audit log."}</p>
        </AdminMutation>
      </Panel>
    </div>}
  </div>;
}
