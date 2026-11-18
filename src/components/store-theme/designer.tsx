"use client";

import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Monitor, Smartphone } from "lucide-react";
import Image from "next/image";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { catalogCopy } from "@/lib/catalog-copy";
import type { Locale } from "@/lib/i18n";
import { defaultDesign, designAssetKinds, designAssetPath, emptyFamilyContent, isFamilyTheme, switchTheme, themeFonts, themeIds, themeRegistry, type AssetKind, type FamilyContent, type ThemeConfig, type ThemeId } from "@/lib/theme-config";
import { familyLabels } from "@/lib/theme-families";
import { themeCopy } from "@/lib/theme-copy";
import { themePreviews } from "@/components/theme-previews";
import { confirmDesign, submitDesign } from "@/server/themes/actions";

type Choice = { id: string; name: string };
type Asset = { id: string; kind: AssetKind };
type Props = {
  locale: Locale; slug: string; initial: ThemeConfig; revision: number; publishedRevision: number | null;
  hasPrevious: boolean;
  owner: boolean; allowed: readonly ThemeId[]; premium: boolean; products: Choice[]; categories: Choice[]; assets: Asset[];
};

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel grid gap-4 p-4 sm:p-6"><h2 className="text-balance text-lg font-black">{title}</h2>{children}</section>;
}

function ChoicePicker({ locale, title, choices, selected, change }: {
  locale: Locale; title: string; choices: Choice[]; selected: string[]; change: (ids: string[]) => void;
}) {
  const t = themeCopy[locale];
  const [search, setSearch] = useState("");
  const visible = choices.filter((choice) => !selected.includes(choice.id) && choice.name.toLocaleLowerCase(locale).includes(search.trim().toLocaleLowerCase(locale))).slice(0, 12);
  return <fieldset className="grid gap-2 rounded-xl border border-line p-3">
    <legend className="px-1 text-sm font-bold">{title}</legend>
    {selected.length > 0 && <ul className="flex flex-wrap gap-2">
      {selected.map((id) => {
        const name = choices.find((choice) => choice.id === id)?.name ?? t.missingChoice;
        return <li key={id}><button type="button" className="button button-secondary min-h-9 px-2" aria-label={`${t.removeChoice} ${name}`} onClick={() => change(selected.filter((value) => value !== id))}><bdi>{name}</bdi><span aria-hidden="true">×</span></button></li>;
      })}
    </ul>}
    <input className="control" type="search" aria-label={`${t.searchChoices} · ${title}`} placeholder={t.searchChoices} value={search} onChange={(event) => setSearch(event.target.value)} />
    {visible.length > 0 && <ul className="flex max-h-36 flex-wrap gap-2 overflow-auto">
      {visible.map(({ id, name }) => <li key={id}><button type="button" className="button button-secondary min-h-9 px-2" disabled={selected.length >= 8} onClick={() => change([...selected, id])}><bdi>{name}</bdi></button></li>)}
    </ul>}
    <p className="text-pretty text-xs text-muted">{t.picksHint}</p>
  </fieldset>;
}

function AssetPicker({ locale, slug, kind, assets, selected, onSelect, onUpload, onDelete }: {
  locale: Locale; slug: string; kind: AssetKind; assets: Asset[]; selected: string | null;
  onSelect: (id: string | null) => void; onUpload: (asset: Asset) => void; onDelete: (id: string) => void;
}) {
  const t = themeCopy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = assets.filter((asset) => asset.kind === kind);
  const c = catalogCopy[locale];

  async function message(response: Response) {
    const body = await response.json().catch(() => null);
    const code = body?.code;
    if (code === "assetInUse") return t.assetInUse;
    return typeof code === "string" && Object.hasOwn(c, code) ? c[code as keyof typeof c] : t.unavailable;
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/theme-assets/${slug}?kind=${kind}`, { method: "POST", body: file, headers: { "Content-Type": file.type } });
      if (!response.ok) setError(await message(response));
      else {
        const { id } = await response.json() as { id: string };
        onUpload({ id, kind });
        onSelect(id);
      }
    } catch { setError(t.unavailable); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!selected) return;
    const id = selected;
    dialog.current?.close();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(designAssetPath(slug, id, true), { method: "DELETE" });
      if (!response.ok) setError(await message(response));
      else { onDelete(id); onSelect(null); }
    } catch { setError(t.unavailable); }
    finally { setBusy(false); }
  }

  return <fieldset className="grid gap-2 rounded-xl border border-line p-3" aria-busy={busy}>
    <legend className="px-1 text-sm font-bold">{t[kind]}</legend>
    {selected && <div className="relative h-24 overflow-hidden rounded-lg bg-leaf"><Image src={designAssetPath(slug, selected, true)} alt={t[kind]} fill unoptimized className="object-contain" /></div>}
    <div role="group" aria-label={`${t.selectAsset} · ${t[kind]}`} className="grid max-h-56 grid-cols-3 gap-2 overflow-auto p-0.5 sm:grid-cols-4">
      <button type="button" aria-pressed={selected === null} disabled={busy} onClick={() => { setError(null); onSelect(null); }}
        className="grid min-h-16 place-items-center rounded-lg border border-line p-1 text-center text-xs font-bold text-muted aria-pressed:border-brand aria-pressed:bg-leaf aria-pressed:text-ink aria-pressed:ring-2 aria-pressed:ring-brand">{t.noAsset}</button>
      {options.map((option, index) => <button key={option.id} type="button" aria-pressed={selected === option.id} disabled={busy}
        aria-label={`${t[kind]} ${index + 1}`} onClick={() => { setError(null); onSelect(option.id); }}
        className="relative aspect-square overflow-hidden rounded-lg border border-line bg-leaf aria-pressed:border-brand aria-pressed:ring-2 aria-pressed:ring-brand">
        <Image src={designAssetPath(slug, option.id, true)} alt="" fill unoptimized sizes="96px" className="object-contain p-1" />
      </button>)}
    </div>
    <label className="field">
      <span className="inline-flex items-center gap-2"><ImagePlus size={16} aria-hidden="true" />{busy ? t.uploading : t.upload}</span>
      <input className="control" type="file" name={kind} aria-label={`${t.upload} · ${t[kind]}`} accept="image/jpeg,image/png,image/webp" disabled={busy}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
    </label>
    {selected && <button type="button" className="button button-secondary justify-self-start" disabled={busy} onClick={() => dialog.current?.showModal()}>{t.remove}</button>}
    {error && <p role="alert" className="error">{error}</p>}
    <dialog ref={dialog} role="alertdialog" aria-labelledby={label} className="panel fixed inset-0 m-auto w-[min(90vw,24rem)] p-5 backdrop:bg-ink/40">
      <h3 id={label} className="mb-4 font-bold">{t.remove} · {t[kind]}</h3>
      <div className="flex flex-wrap gap-2">
        <button type="button" autoFocus className="button button-secondary" onClick={() => dialog.current?.close()}>{t.cancel}</button>
        <button type="button" className="button button-primary" onClick={() => void remove()}>{t.confirmation}</button>
      </div>
    </dialog>
  </fieldset>;
}

function DesignCommand({ locale, slug, revision, operation, disabled }: {
  locale: Locale; slug: string; revision: number; operation: "publish" | "restore" | "restorePrevious"; disabled: boolean;
}) {
  const t = themeCopy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const label = useId();
  const [error, action, busy] = useActionState(async () => confirmDesign(locale, slug, revision, operation), null);
  return <>
    <button type="button" className="button button-secondary" disabled={disabled} onClick={() => dialog.current?.showModal()}>{t[operation]}</button>
    <dialog ref={dialog} role="alertdialog" aria-labelledby={label} className="panel fixed inset-0 m-auto w-[min(90vw,24rem)] p-5 backdrop:bg-ink/40">
      <h3 id={label} className="mb-4 font-bold">{t[operation]}</h3>
      <form action={action} className="grid gap-3">
        {error && <p role="alert" className="error">{t[error]}</p>}
        <div className="flex flex-wrap gap-2">
          <button autoFocus type="button" className="button button-secondary" disabled={busy} onClick={() => dialog.current?.close()}>{t.cancel}</button>
          <button className="button button-primary" disabled={busy}>{busy ? t.working : t.confirmation}</button>
        </div>
      </form>
    </dialog>
  </>;
}

function Preview({ locale, slug, revision }: { locale: Locale; slug: string; revision: number }) {
  const t = themeCopy[locale];
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const viewport = device === "phone" ? 390 : 1200;
  const height = device === "phone" ? 740 : 920;
  const scale = Math.min(1, width / viewport);
  const path = `/${locale}/dashboard/stores/${slug}/design/preview?revision=${revision}`;
  return <aside className="panel grid content-start gap-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-balance text-lg font-black">{t.preview}</h2>
      <a className="button button-secondary" href={path} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" />{t.openPreview}</a>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" aria-pressed={device === "phone"} className="button button-secondary aria-pressed:bg-leaf" onClick={() => setDevice("phone")}><Smartphone size={17} aria-hidden="true" />{t.phone}</button>
      <button type="button" aria-pressed={device === "desktop"} className="button button-secondary aria-pressed:bg-leaf" onClick={() => setDevice("desktop")}><Monitor size={17} aria-hidden="true" />{t.desktop}</button>
    </div>
    <p className="text-pretty text-sm text-muted">{t.previewHint}</p>
    <div ref={host} className="min-w-0 overflow-hidden rounded-xl border border-line bg-canvas">
      <div className="relative mx-auto" style={{ width: viewport * scale, height: height * scale }}>
        <iframe title={t.preview} src={path} className="absolute start-0 top-0 border-0" width={viewport} height={height}
          style={{ transform: `scale(${scale})`, transformOrigin: locale === "ar" ? "top right" : "top left" }} />
      </div>
    </div>
  </aside>;
}

export function Designer({ locale, slug, initial, revision, publishedRevision, hasPrevious, owner, allowed, premium, products, categories, assets }: Props) {
  const t = themeCopy[locale];
  const [config, setConfig] = useState(initial);
  const [files, setFiles] = useState(assets);
  const [error, action, pending] = useActionState(submitDesign.bind(null, locale, slug, revision), null);
  const dirty = JSON.stringify(initial) !== JSON.stringify(config);
  const family = isFamilyTheme(config.theme) ? config.theme : null;
  const content = family ? config.familyContent?.[family] ?? emptyFamilyContent : null;
  const ar = locale === "ar";

  // Warn before the browser discards edits (tab close, reload, external navigation). A successful save
  // replaces `initial`, so the guard lifts itself without special handling.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function changeFamilyContent(key: keyof FamilyContent, value: string) {
    if (!family) return;
    setConfig((current) => ({
      ...current,
      familyContent: {
        ...current.familyContent,
        [family]: { ...emptyFamilyContent, ...current.familyContent?.[family], [key]: value },
      },
    }));
  }

  function move(index: number, delta: number) {
    setConfig((current) => {
      const sections = [...current.sections];
      [sections[index], sections[index + delta]] = [sections[index + delta], sections[index]];
      return { ...current, sections };
    });
  }

  return <>
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <button form="design-form" className="button button-primary" disabled={pending}>{pending ? t.working : t.saveDraft}</button>
      {owner && <DesignCommand locale={locale} slug={slug} revision={revision} operation="publish" disabled={dirty || pending || revision === 0 || revision === publishedRevision} />}
      <DesignCommand locale={locale} slug={slug} revision={revision} operation="restore" disabled={pending || publishedRevision === null} />
      {owner && hasPrevious && <DesignCommand locale={locale} slug={slug} revision={revision} operation="restorePrevious" disabled={pending} />}
    </div>
    {dirty && <div className="mb-3 flex flex-wrap items-center gap-3" role="status">
      <p className="text-sm text-muted">{t.unsaved}</p>
      <button type="button" className="button button-secondary min-h-9 px-3" disabled={pending} onClick={() => setConfig(initial)}>{t.discard}</button>
    </div>}
    {!owner && <p className="mb-3 text-sm text-muted">{t.ownerOnly}</p>}
    {error && <p className="error mb-4" role="alert">{t[error]}</p>}
    <div className="wajhati-designer-layout">
      <div className="wajhati-designer-preview"><Preview locale={locale} slug={slug} revision={revision} /></div>
      <form id="design-form" action={action} className="grid min-w-0 gap-4" aria-busy={pending}>
        <input type="hidden" name="config" value={JSON.stringify(config)} />
        <Panel title={t.library}>
          <fieldset className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <legend className="sr-only">{t.library}</legend>
            {themeIds.map((id) => <label key={id} className="wajhati-theme-choice grid cursor-pointer gap-2 rounded-xl border border-line p-3 has-checked:border-brand has-checked:bg-leaf">
              <span className="inline-flex items-center gap-2 text-sm font-extrabold" dir="ltr">
                <input type="radio" name="theme" value={id} checked={config.theme === id} disabled={!allowed.includes(id)} onChange={() => setConfig(switchTheme(config, id))} />
                {themeRegistry[id].title}
              </span>
              {isFamilyTheme(id) && <span className="wajhati-theme-choice-image"><Image src={themePreviews[id][locale]} alt={locale === "ar" ? "معاينة بمحتوى توضيحي" : "Preview with illustrative content"} sizes="(max-width: 639px) 85vw, 300px" /></span>}
              <span aria-hidden="true" className="grid h-9 grid-cols-4 gap-1 overflow-hidden rounded-md border border-line">
                {Object.values(themeRegistry[id].colors).map((color) => <span key={color} style={{ backgroundColor: color }} />)}
              </span>
              <span className="text-pretty text-xs text-muted">{isFamilyTheme(id) ? familyLabels[locale][id].description : id === "minimal-commerce" ? t.minimal : t.luxury}</span>
            </label>)}
          </fieldset>
        </Panel>
        <Panel title={t.colors}>
          {!premium && <button type="button" className="button button-secondary" onClick={() => {
            const basic = defaultDesign(family ?? "minimal-commerce");
            const next = switchTheme(config, basic.theme);
            setConfig({ ...next, font: basic.font, colors: basic.colors });
          }}>{locale === "ar" ? "استخدم الألوان والخط الأساسيين" : "Use the basic colors and font"}</button>}
          <label className="field">{t.font}<select className="control" name="font" disabled={!premium} value={config.font} onChange={(event) => setConfig({ ...config, font: event.target.value === "editorial" ? "editorial" : "sans" })}>
            {themeFonts.map((font) => <option key={font} value={font}>{family && font === "sans" ? "Cairo / Manrope" : t[font]}</option>)}
          </select></label>
          <div className="grid grid-cols-2 gap-3">
            {(["background", "text", "accent", "onAccent"] as const).map((color) => <label key={color} className="field">{t[color]}
              <input type="color" name={color} disabled={!premium} className="control h-11 p-1" value={config.colors[color]} onChange={(event) => setConfig({ ...config, colors: { ...config.colors, [color]: event.target.value.toUpperCase() } })} />
            </label>)}
          </div>
        </Panel>
        {family && content && <Panel title={familyLabels[locale][family].editorial}>
          {(["Ar", "En"] as const).map((language) => {
            const direction = language === "Ar" ? "rtl" : "ltr";
            const languageLabel = language === "Ar" ? (ar ? "بالعربية" : "Arabic") : (ar ? "بالإنجليزية" : "English");
            return <div className="grid gap-3" key={language}>
              <label className="field">{ar ? "عبارة فوق العنوان" : "Hero eyebrow"} · {languageLabel}
                <input className="control" dir={direction} maxLength={80} value={content[`kicker${language}`]} onChange={(event) => changeFamilyContent(`kicker${language}`, event.target.value)} />
              </label>
              <label className="field">{ar ? "عنوان القسم" : "Section heading"} · {languageLabel}
                <input className="control" dir={direction} maxLength={120} value={content[`heading${language}`]} onChange={(event) => changeFamilyContent(`heading${language}`, event.target.value)} />
              </label>
              <label className="field">{ar ? "نص القسم" : "Section text"} · {languageLabel}
                <textarea className="control min-h-20" dir={direction} maxLength={520} value={content[`body${language}`]} onChange={(event) => changeFamilyContent(`body${language}`, event.target.value)} />
              </label>
            </div>;
          })}
        </Panel>}
        <Panel title={t.content}>
          {(["titleAr", "titleEn", "descriptionAr", "descriptionEn"] as const).map((key) => <label key={key} className="field">{t[key]}
            {key.startsWith("title") ? <input className="control" name={key} dir={key.endsWith("Ar") ? "rtl" : "ltr"} maxLength={120} value={config.hero[key]} onChange={(event) => setConfig({ ...config, hero: { ...config.hero, [key]: event.target.value } })} />
              : <textarea className="control min-h-20" name={key} dir={key.endsWith("Ar") ? "rtl" : "ltr"} maxLength={320} value={config.hero[key]} onChange={(event) => setConfig({ ...config, hero: { ...config.hero, [key]: event.target.value } })} />}
          </label>)}
        </Panel>
        <Panel title={t.media}>
          {designAssetKinds.map((kind) => <AssetPicker key={kind} locale={locale} slug={slug} kind={kind} assets={files} selected={config.assets[kind]}
            onSelect={(id) => setConfig((current) => ({ ...current, assets: { ...current.assets, [kind]: id } }))}
            onUpload={(asset) => setFiles((current) => [asset, ...current])} onDelete={(id) => setFiles((current) => current.filter((asset) => asset.id !== id))} />)}
        </Panel>
        <Panel title={t.sections}>
          <ol className="grid gap-2">
            {config.sections.map(({ id, visible }, index) => <li key={id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-2">
              <label className="flex min-h-11 min-w-0 items-center gap-2 text-sm font-bold"><input type="checkbox" aria-label={`${t.show} · ${t[id === "editorial" ? "editorialSection" : id]}`} className="accent-brand" checked={visible} disabled={id === "products"}
                onChange={(event) => setConfig({ ...config, sections: config.sections.map((section) => section.id === id ? { id, visible: event.target.checked } : section) })} />{t[id === "editorial" ? "editorialSection" : id]}</label>
              <div className="flex gap-1">
                <button type="button" className="button button-secondary px-2" aria-label={`${t.moveUp} · ${t[id === "editorial" ? "editorialSection" : id]}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} aria-hidden="true" /></button>
                <button type="button" className="button button-secondary px-2" aria-label={`${t.moveDown} · ${t[id === "editorial" ? "editorialSection" : id]}`} disabled={index === config.sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} aria-hidden="true" /></button>
              </div>
            </li>)}
          </ol>
          <ChoicePicker locale={locale} title={t.productPicks} choices={products} selected={config.products} change={(ids) => setConfig({ ...config, products: ids })} />
          <ChoicePicker locale={locale} title={t.categoryPicks} choices={categories} selected={config.categories} change={(ids) => setConfig({ ...config, categories: ids })} />
        </Panel>
        <button className="button button-primary justify-self-start" disabled={pending}>{pending ? t.working : t.saveDraft}</button>
      </form>
    </div>
  </>;
}
