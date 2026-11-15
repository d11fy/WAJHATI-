"use client";

import { useActionState, useState } from "react";
import { channels, orderMessage, type Contact } from "@/lib/checkout";
import type { Currency } from "@/lib/catalog";
import type { Locale } from "@/lib/i18n";
import { orderCopy } from "@/lib/order-copy";
import { submitContact, submitOrderChange } from "@/server/orders/actions";

export function ContactForm({ locale, slug, name, currency, initial, owner }: { locale: Locale; slug: string; name: string; currency: Currency; initial: Contact; owner: boolean }) {
  const t = orderCopy[locale];
  const [config, setConfig] = useState(initial);
  const [language, setLanguage] = useState(locale);
  const [error, action, pending] = useActionState(submitContact.bind(null, locale, slug), null);
  const message = orderMessage({ name, currency, locale: language, greeting: language === "ar" ? config.greetingAr : config.greetingEn,
    total: 12000, reference: "DM-00000000000000000000", lines: [{ product: "sample", quantity: 1, options: [], nameAr: orderCopy.ar.exampleProduct, nameEn: orderCopy.en.exampleProduct, unitMinor: 12000, imageId: null }] });
  return <form action={action} className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
    <input type="hidden" name="config" value={JSON.stringify(config)} />
    <fieldset disabled={!owner || pending} className="panel grid gap-4 p-4 sm:p-6">
      <legend className="sr-only">{t.contact}</legend>
      {!owner && <p className="text-sm text-muted">{t.ownerOnly}</p>}
      {(["enabled", "whatsapp", "instagram", "showContact"] as const).map((key) => <label className="flex min-h-11 items-center gap-2 font-semibold" key={key}>
        <input type="checkbox" name={key} checked={config[key]} onChange={(event) => {
          const checked = event.target.checked;
          setConfig((current) => {
            const next = { ...current, [key]: checked };
            if (key === "whatsapp" || key === "instagram") next.defaultChannel = next.defaultChannel && next[next.defaultChannel] ? next.defaultChannel : channels.find((channel) => next[channel]) ?? null;
            return next;
          });
        }} />{t[key]}</label>)}
      <label className="field">{t.defaultChannel}<select className="control" name="defaultChannel" value={config.defaultChannel ?? ""} onChange={(event) => {
        const value = event.target.value;
        setConfig({ ...config, defaultChannel: value === "whatsapp" || value === "instagram" ? value : null });
      }}><option value="">{t.none}</option>{channels.filter((channel) => config[channel]).map((channel) => <option key={channel} value={channel}>{t[channel]}</option>)}</select></label>
      <label className="field">{t.phone}<input className="control" name="phone" type="tel" dir="ltr" maxLength={16} placeholder="+12025550123" value={config.phone} onChange={(event) => setConfig({ ...config, phone: event.target.value })} /></label>
      <label className="field">{t.handle}<input className="control" name="handle" dir="ltr" maxLength={30} value={config.handle} onChange={(event) => setConfig({ ...config, handle: event.target.value })} /></label>
      {(["greetingAr", "greetingEn", "instructionsAr", "instructionsEn"] as const).map((key) => <label key={key} className="field">{t[key]}
        <textarea className="control" name={key} dir={key.endsWith("Ar") ? "rtl" : "ltr"} rows={2} maxLength={key.startsWith("greeting") ? 240 : 400}
          value={config[key]} onChange={(event) => setConfig({ ...config, [key]: event.target.value })} />
      </label>)}
      {error && <p className="error" role="alert">{error === "invalid" ? t.invalid : t.failed}</p>}
      <button type="submit" className="button button-primary justify-self-start">{pending ? t.busy : t.save}</button>
    </fieldset>
    <section className="panel self-start p-4 sm:p-6">
      <h2 className="text-lg font-black">{t.example}</h2>
      <div className="my-3 flex gap-2">{(["ar", "en"] as const).map((value) => <button type="button" className="button button-secondary aria-pressed:bg-leaf" aria-pressed={language === value}
        key={value} onClick={() => setLanguage(value)}>{value === "ar" ? "العربية" : "English"}</button>)}</div>
      <pre className="whitespace-pre-wrap wrap-anywhere rounded-xl bg-canvas p-3 text-sm" dir={language === "ar" ? "rtl" : "ltr"}>{message}</pre>
    </section>
  </form>;
}

export function OrderCommand({ locale, slug, reference, operation }: { locale: Locale; slug: string; reference: string; operation: "confirm" | "cancel" | "archive" }) {
  const t = orderCopy[locale];
  const [error, action, pending] = useActionState(submitOrderChange.bind(null, locale, slug, reference, operation), null);
  return <form action={action} className="grid gap-2 rounded-xl border border-line p-3">
    <label className="flex min-h-11 items-center gap-2 text-sm"><input name="acknowledge" type="checkbox" required />{t.acknowledge}</label>
    <button className={`button ${operation === "confirm" ? "button-primary" : "button-secondary"}`} disabled={pending}>{pending ? t.busy : t[operation]}</button>
    {error && <p className="error" role="alert">{error === "acknowledge" ? t.acknowledge : t.conflict}</p>}
  </form>;
}
