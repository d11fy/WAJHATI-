"use client";

import { ArrowRight, Check } from "lucide-react";
import { useActionState, useState } from "react";
import { LegalAcknowledgement } from "@/components/legal-links";
import { copy } from "@/lib/copy";
import type { Locale } from "@/lib/i18n";
import { storeInput } from "@/lib/validation";
import { submitStore } from "@/server/stores/actions";

type Option = { value: string; label: string };
const identity = storeInput.pick({ name: true, slug: true });

export function StoreWizard({ locale, countries, currencies }: { locale: Locale; countries: Option[]; currencies: Option[] }) {
  const t = copy[locale];
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [identityError, setIdentityError] = useState(false);
  const [error, action, pending] = useActionState(submitStore.bind(null, locale), null);
  const ar = locale === "ar";
  const numbers = new Intl.NumberFormat(locale);
  const steps = [t.identity, t.market];

  function advance() {
    const parsed = identity.safeParse({ name, slug });
    setIdentityError(!parsed.success);
    if (!parsed.success) return;
    setName(parsed.data.name);
    setSlug(parsed.data.slug);
    setStep(2);
  }

  return (
    <section className="wajhati-wizard">
      <aside><h2>{ar ? "متجرك يبدأ هنا" : "Your store starts here"}</h2><p>{ar ? "نرافقك في كل خطوة." : "We’ll guide you through each step."}</p>
        <ol aria-label={t.step}>{steps.map((title, index) => (
          <li key={title} aria-current={step === index + 1 ? "step" : undefined}>
            <span>{step > index + 1 ? <Check size={15} aria-hidden="true" /> : numbers.format(index + 1)}</span>{title}
          </li>
        ))}</ol>
      </aside>
      <div className="panel wajhati-wizard-card">
      <p className="tag">{t.step} {numbers.format(step)} / {numbers.format(steps.length)}</p>
      <h1>{step === 1 ? (ar ? "اختر اسم متجرك ورابطه" : "Choose your store name and link") : (ar ? "اختر البلد والعملة" : "Choose a country and currency")}</h1>
      <p className="wajhati-auth-intro">{step === 1 ? t.wizardIntro : (ar ? "تُستخدم العملة المختارة لعرض أسعار المنتجات في متجرك." : "Your store uses the selected currency for product prices.")}</p>
      <form action={action} onSubmit={(event) => { if (step === 1) { event.preventDefault(); advance(); } }} aria-busy={pending}>
        <fieldset hidden={step !== 1} className={step === 1 ? "grid gap-4" : "hidden"}>
          <label className="field">{t.storeName}
            <input className="control" name="name" dir="auto" value={name} onChange={(event) => setName(event.target.value)} placeholder={ar ? "مثلًا، متجر ورد" : "For example, Rose Shop"} minLength={2} maxLength={80} required />
          </label>
          <label className="field">{t.storeLink}
            <span className="flex items-center gap-2 rounded-xl border border-line bg-canvas px-3" dir="ltr">
              <span className="shrink-0 text-xs text-muted">/{locale}/s/</span>
              <input className="min-h-12 w-full min-w-0 bg-transparent" name="slug" value={slug} onChange={(event) => setSlug(event.target.value)} minLength={3} maxLength={48} autoCapitalize="none" spellCheck={false} required aria-describedby="slug-hint" placeholder="olive-house" />
            </span>
          </label>
          <p id="slug-hint" className="-mt-2 text-xs text-muted">{t.slugHelp}</p>
          <p className="wajhati-wizard-url" dir="ltr">/{locale}/s/{slug || "my-store"}</p>
          {identityError && <p role="alert" className="error">{t.invalid}</p>}
        </fieldset>
        <fieldset hidden={step !== 2} className={step === 2 ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
          <label className="field">{t.country}
            <select className="control" name="country" required={step === 2} value={country} onChange={(event) => setCountry(event.target.value)}>
              <option value="">{t.chooseCountry}</option>
              {countries.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="field">{t.currency}
            <select className="control" name="currency" required={step === 2} value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <option value="">{t.chooseCurrency}</option>
              {currencies.map(({ value, label }) => <option key={value} value={value}>{label} ({value})</option>)}
            </select>
          </label>
        </fieldset>
        {error && step === 2 && <p role="alert" className="error mt-4">{t[error]}</p>}
        {step === 2 && <LegalAcknowledgement locale={locale} className="mt-4 text-xs text-muted" />}
        <div className="wajhati-wizard-actions">
          {step === 1 ? <button type="submit" className="button button-primary">{t.next}<ArrowRight size={16} className="arrow" aria-hidden="true" /></button> : (
            <>
              <button type="button" className="button button-secondary" onClick={() => setStep(1)} disabled={pending}>{t.back}</button>
              <button type="submit" className="button button-primary" disabled={pending}>{pending ? t.busy : t.createStore}</button>
            </>
          )}
        </div>
      </form>
      </div>
    </section>
  );
}
