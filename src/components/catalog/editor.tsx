"use client";

import { useActionState, useState } from "react";
import { AIWritingAssistant } from "@/components/ai/writing-assistant";
import { catalogCopy } from "@/lib/catalog-copy";
import type { Locale } from "@/lib/i18n";
import { confirmCatalogAction, submitCategory, submitProduct } from "@/server/catalog/actions";

type Identity = { nameAr: string; nameEn: string; slug: string; position: string };
const emptyIdentity: Identity = { nameAr: "", nameEn: "", slug: "", position: "0" };
type ProductFields = Identity & {
  descriptionAr: string; descriptionEn: string; price: string; compareAt: string; sku: string; options: string;
  state: "draft" | "published"; featured: boolean; available: boolean; categoryIds: string[];
};
const emptyProduct: ProductFields = {
  ...emptyIdentity, descriptionAr: "", descriptionEn: "", price: "", compareAt: "", sku: "", options: "",
  state: "draft", featured: false, available: true, categoryIds: [],
};

type Assist = { store: string; context?: { category?: string } };

function IdentityFields({ locale, fields, change, assist }: { locale: Locale; fields: Identity; change: (key: keyof Identity, value: string) => void; assist?: Assist }) {
  const t = catalogCopy[locale];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid content-start gap-2">
        <label className="field">{t.nameAr}<input className="control" name="nameAr" dir="rtl" maxLength={100} required value={fields.nameAr} onChange={(e) => change("nameAr", e.target.value)} /></label>
        {assist && <div><AIWritingAssistant locale={locale} slug={assist.store} fieldId="product.nameAr" value={fields.nameAr} siblingValue={fields.nameEn} context={assist.context} onApply={(text) => change("nameAr", text)} /></div>}
      </div>
      <div className="grid content-start gap-2">
        <label className="field">{t.nameEn}<input className="control" name="nameEn" dir="ltr" maxLength={100} value={fields.nameEn} onChange={(e) => change("nameEn", e.target.value)} /></label>
        {assist && <div><AIWritingAssistant locale={locale} slug={assist.store} fieldId="product.nameEn" value={fields.nameEn} siblingValue={fields.nameAr} context={assist.context} onApply={(text) => change("nameEn", text)} /></div>}
      </div>
      <label className="field">{t.slug}<input className="control" name="slug" dir="ltr" minLength={3} maxLength={48} autoCapitalize="none" spellCheck={false} required value={fields.slug} onChange={(e) => change("slug", e.target.value)} /></label>
      <label className="field">{t.position}<input className="control" name="position" dir="ltr" inputMode="numeric" maxLength={6} required value={fields.position} onChange={(e) => change("position", e.target.value)} /></label>
    </div>
  );
}

export function CategoryEditor({ locale, store, id, initial }: { locale: Locale; store: string; id: string | null; initial?: Identity & { visible: boolean } }) {
  const t = catalogCopy[locale];
  const [fields, setFields] = useState(initial ?? { ...emptyIdentity, visible: true });
  const [error, action, pending] = useActionState(submitCategory.bind(null, locale, store, id), null);
  return (
    <form action={action} className="panel grid gap-4 p-5 sm:p-6" aria-busy={pending}>
      <IdentityFields locale={locale} fields={fields} change={(key, value) => setFields((old) => ({ ...old, [key]: value }))} />
      <label className="inline-flex min-h-10 items-center gap-2 font-bold"><input className="accent-brand" type="checkbox" name="visible" checked={fields.visible} onChange={(e) => setFields({ ...fields, visible: e.target.checked })} />{t.visible}</label>
      {error && <p className="error" role="alert">{t[error]}</p>}
      <button className="button button-primary justify-self-start" disabled={pending}>{pending ? t.loading : t.save}</button>
    </form>
  );
}

export function ProductEditor({ locale, store, currency, id, initial, categories, ai = false }: {
  locale: Locale; store: string; currency: string; id: string | null; initial?: ProductFields; ai?: boolean;
  categories: { id: string; label: string }[];
}) {
  const t = catalogCopy[locale];
  const [fields, setFields] = useState(initial ?? emptyProduct);
  const [error, action, pending] = useActionState(submitProduct.bind(null, locale, store, id), null);
  const change = <K extends keyof ProductFields>(key: K, value: ProductFields[K]) => setFields((old) => ({ ...old, [key]: value }));
  function toggleCategory(id: string, checked: boolean) {
    change("categoryIds", checked ? [...fields.categoryIds, id] : fields.categoryIds.filter((category) => category !== id));
  }
  return (
    <form action={action} className="panel grid gap-5 p-5 sm:p-6" aria-busy={pending}>
      <IdentityFields locale={locale} fields={fields} change={change} assist={ai ? { store } : undefined} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2"><label className="field">{t.descriptionAr}<textarea className="control min-h-24" name="descriptionAr" dir="rtl" maxLength={2000} value={fields.descriptionAr} onChange={(e) => change("descriptionAr", e.target.value)} /></label>
          {ai && <div><AIWritingAssistant locale={locale} slug={store} fieldId="product.descriptionAr" value={fields.descriptionAr} siblingValue={fields.descriptionEn} context={{ productName: fields.nameAr || fields.nameEn }} onApply={(text) => change("descriptionAr", text)} /></div>}</div>
        <div className="grid content-start gap-2"><label className="field">{t.descriptionEn}<textarea className="control min-h-24" name="descriptionEn" dir="ltr" maxLength={2000} value={fields.descriptionEn} onChange={(e) => change("descriptionEn", e.target.value)} /></label>
          {ai && <div><AIWritingAssistant locale={locale} slug={store} fieldId="product.descriptionEn" value={fields.descriptionEn} siblingValue={fields.descriptionAr} context={{ productName: fields.nameEn || fields.nameAr }} onApply={(text) => change("descriptionEn", text)} /></div>}</div>
        <label className="field">{t.price} ({currency})<input className="control" name="price" dir="ltr" inputMode="decimal" maxLength={20} required value={fields.price} onChange={(e) => change("price", e.target.value)} /></label>
        <label className="field">{t.compareAt} ({currency})<input className="control" name="compareAt" dir="ltr" inputMode="decimal" maxLength={20} value={fields.compareAt} onChange={(e) => change("compareAt", e.target.value)} /></label>
        <label className="field">{t.sku}<input className="control" name="sku" dir="auto" maxLength={64} value={fields.sku} onChange={(e) => change("sku", e.target.value)} /></label>
        <label className="field">{t.status}<select className="control" name="state" value={fields.state} onChange={(e) => change("state", e.target.value === "published" ? "published" : "draft")}>
          <option value="draft">{t.draft}</option><option value="published">{t.published}</option>
        </select></label>
      </div>
      <div className="flex flex-wrap gap-4">
        {(["featured", "available"] as const).map((key) => <label key={key} className="inline-flex min-h-10 items-center gap-2 font-bold">
          <input className="accent-brand" type="checkbox" name={key} checked={fields[key]} onChange={(e) => change(key, e.target.checked)} />{t[key]}
        </label>)}
      </div>
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-2 text-sm font-bold">{t.categories}</legend>
        <div className="flex max-h-48 flex-wrap gap-x-4 overflow-y-auto">
          {categories.length ? categories.map(({ id, label }) => <label key={id} className="inline-flex min-h-10 items-center gap-2 text-sm">
            <input className="accent-brand" type="checkbox" name="categoryIds" value={id} checked={fields.categoryIds.includes(id)} onChange={(e) => toggleCategory(id, e.target.checked)} /><bdi>{label}</bdi>
          </label>) : <p className="text-sm text-muted">{t.noCategories}</p>}
        </div>
      </fieldset>
      <label className="field">{t.options}<textarea className="control min-h-24" name="options" dir="auto" maxLength={2000} aria-describedby="option-help" value={fields.options} onChange={(e) => change("options", e.target.value)} /></label>
      <p id="option-help" className="-mt-4 text-xs text-muted">{t.optionsHelp}</p>
      {error && <p className="error" role="alert">{t[error]}</p>}
      <button className="button button-primary justify-self-start" disabled={pending}>{pending ? t.loading : t.save}</button>
    </form>
  );
}

export function ConfirmCatalog({ locale, store, operation, id = null }: {
  locale: Locale; store: string; operation: "deleteCategory" | "archiveProduct" | "publishStore" | "unpublishStore"; id?: string | null;
}) {
  const t = catalogCopy[locale];
  const [confirming, setConfirming] = useState(false);
  const [error, action, pending] = useActionState(async () => confirmCatalogAction(locale, store, operation, id), null);
  const className = `button ${operation === "publishStore" ? "button-primary" : "button-secondary"}`;
  return (
    <div>
      {confirming ? <form action={action} className="flex flex-wrap items-center gap-2" aria-label={t[operation]}>
        <button className={className} disabled={pending}>{pending ? t.loading : t.confirm}</button>
        <button type="button" className="button button-secondary" disabled={pending} onClick={() => setConfirming(false)}>{t.cancel}</button>
      </form> : <button type="button" className={className} onClick={() => setConfirming(true)}>{t[operation]}</button>}
      {confirming && error && <p className="error mt-2" role="alert">{t[error]}</p>}
    </div>
  );
}
