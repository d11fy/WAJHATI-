"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { aiTones, readThemeText, themeTextFields, writeThemeText, type AiTone, type ThemeTextField } from "@/lib/ai/fields";
import { fillLanguages } from "@/lib/ai/schemas";
import { aiCopy } from "@/lib/ai-copy";
import type { Locale } from "@/lib/i18n";
import { themeConfig, type ThemeConfig } from "@/lib/theme-config";
import { aiFill, aiWalletStatus } from "@/server/ai/actions";
import type { WalletView } from "@/server/ai/wallet-view";

type Language = "ar" | "en" | "both";
type Props = {
  locale: Locale; slug: string; config: ThemeConfig; owner: boolean;
  /** Receives the new design. `save` asks the designer to submit it through the normal draft flow. Never publishes. */
  onApply: (next: ThemeConfig, save: boolean) => void;
};
type Row = { field: ThemeTextField; old: string; next: string };

/**
 * One-click store copy for the selected theme. Only text fields that exist in this theme's ThemeConfig can change (hero text, and the editorial
 * content of the six family themes). The merchant reviews an old-versus-new comparison and accepts everything or chosen fields. The result goes to
 * the designer's draft; images, colors, fonts, section order and publishing are untouched.
 */
export function StoreContentBuilder({ locale, slug, config, owner, onApply }: Props) {
  const t = aiCopy[locale];
  const b = t.builder;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [wallet, setWallet] = useState<WalletView | null | undefined>(undefined);
  const [idea, setIdea] = useState("");
  const [business, setBusiness] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState<AiTone>("professional");
  const [languages, setLanguages] = useState<Language>("both");
  const [useStore, setUseStore] = useState(true);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [pending, start] = useTransition();
  const run = useRef(0);

  const operation = idea.trim() ? "store_from_idea" : "theme_fill";
  const cost = wallet?.costs[operation];
  const total = wallet ? wallet.balance + wallet.extra : 0;
  const count = themeTextFields(config.theme).length;
  const blocked = wallet === undefined ? false : !wallet || !wallet.available;
  const billing = `/${locale}/dashboard/stores/${slug}/billing`;

  function open() {
    setRows(null); setError(null); setOutOfCredits(false);
    dialog.current?.showModal();
    void aiWalletStatus(locale, slug).then(setWallet).catch(() => setWallet(null));
  }
  function close() { run.current++; dialog.current?.close(); }

  function generate() {
    setError(null); setOutOfCredits(false); setRows(null);
    const ticket = ++run.current;
    start(async () => {
      const result = await aiFill(locale, slug, {
        theme: config.theme, idea, businessType: business, audience, tone, languages, useStoreData: useStore, key: crypto.randomUUID(),
      }).catch(() => null);
      if (ticket !== run.current) return;
      if (!result) { setError(t.errors.unavailable); return; }
      if (!result.ok) { setError(t.errors[result.error]); setOutOfCredits(result.error === "insufficient" || result.error === "no_plan"); return; }
      const fields = themeTextFields(config.theme, fillLanguages(languages));
      const next = fields.flatMap((field) => typeof result.values[field.path] === "string"
        ? [{ field, old: readThemeText(config, field), next: result.values[field.path] }] : []);
      setRows(next);
      setPicked(new Set(next.filter((row) => row.next !== row.old).map((row) => row.field.path)));
      setWallet((current) => current ? { ...current, balance: result.balance, extra: result.extra } : current);
    });
  }

  function apply(all: boolean, save: boolean) {
    if (!rows) return;
    const chosen = rows.filter((row) => (all || picked.has(row.field.path)) && row.next !== row.old);
    if (!chosen.length) { setError(b.nothing); return; }
    const next = writeThemeText(config, new Map(chosen.map((row) => [row.field, row.next])));
    // Defense in depth: the server action revalidates the draft, but never hand the designer a configuration its own schema would refuse.
    if (!themeConfig.safeParse(next).success) { setError(t.errors.bad_output); return; }
    onApply(next, save);
    close();
  }

  function toggle(path: string, on: boolean) {
    setPicked((current) => { const copy = new Set(current); if (on) copy.add(path); else copy.delete(path); return copy; });
  }

  return <>
    <button type="button" className="button button-primary gap-2" onClick={open}><Sparkles size={17} aria-hidden="true" />{b.open}</button>
    <dialog ref={dialog} aria-labelledby={titleId} className="panel fixed inset-0 m-auto max-h-[94vh] w-[min(95vw,52rem)] overflow-auto p-5 backdrop:bg-ink/40">
      <div className="grid gap-4">
        <div>
          <h3 id={titleId} className="flex items-center gap-2 text-xl font-black"><Sparkles size={20} className="text-brand" aria-hidden="true" />{t.brand} · {b.title}</h3>
          <p className="mt-1 text-sm text-muted">{b.intro}</p>
          <p className="text-xs text-muted">{b.fields(count)} · {b.draftOnly}</p>
        </div>
        {wallet === null && <p className="error" role="alert">{t.meter.unavailable}</p>}
        {wallet && !wallet.available && <p className="error" role="alert">{wallet.reason === "no_plan" ? t.errors.no_plan : wallet.reason === "not_configured" ? t.errors.not_configured : wallet.reason === "suspended" ? t.errors.suspended : t.errors.disabled}</p>}
        {!rows && <div className="grid gap-3" aria-busy={pending}>
          <label className="field">{b.idea}
            <textarea className="control min-h-24" maxLength={600} value={idea} onChange={(event) => setIdea(event.target.value)} disabled={pending} />
            <span className="text-xs font-normal text-muted">{b.ideaHint}</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="field">{b.business}<input className="control" maxLength={80} value={business} onChange={(event) => setBusiness(event.target.value)} disabled={pending} /></label>
            <label className="field">{b.audience}<input className="control" maxLength={120} value={audience} onChange={(event) => setAudience(event.target.value)} disabled={pending} /></label>
            <label className="field">{b.tone}<select className="control" value={tone} onChange={(event) => setTone(aiTones.find((item) => item === event.target.value) ?? "professional")} disabled={pending}>
              {aiTones.map((item) => <option key={item} value={item}>{t.tones[item]}</option>)}</select></label>
            <label className="field">{b.language}<select className="control" value={languages} onChange={(event) => setLanguages(event.target.value === "ar" ? "ar" : event.target.value === "en" ? "en" : "both")} disabled={pending}>
              <option value="both">{b.both}</option><option value="ar">{b.arabic}</option><option value="en">{b.english}</option></select></label>
          </div>
          <label className="inline-flex min-h-10 items-center gap-2 text-sm font-bold"><input className="accent-brand" type="checkbox" checked={useStore} onChange={(event) => setUseStore(event.target.checked)} disabled={pending} />{b.useStore}</label>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-leaf px-3 py-2 text-sm" aria-live="polite">
            <span><strong>{t.cost}:</strong> {cost === undefined ? "…" : t.costUnit(cost)} · {idea.trim() ? b.costIdea : b.costFill}</span>
            <span><strong>{t.balance}:</strong> <bdi>{wallet ? total : "…"}</bdi></span>
          </div>
          <p className="-mt-2 text-xs text-muted">{t.chargeNote}</p>
        </div>}
        {error && <div className="error grid gap-2" role="alert">
          <p>{error}</p>
          {outOfCredits && <p className="flex flex-wrap items-center gap-3 font-bold"><span className="font-normal">{t.outOfCredits}</span>{owner && <Link className="underline" href={billing}>{t.billingLink}</Link>}</p>}
        </div>}
        {pending && <p role="status" className="text-sm font-bold text-brand">{t.generating}</p>}
        {rows && <div className="grid gap-3">
          <p className="font-bold">{b.review}</p>
          <p className="text-xs text-muted">{t.reviewNote}</p>
          <label className="inline-flex min-h-9 items-center gap-2 text-sm font-bold"><input className="accent-brand" type="checkbox"
            checked={rows.every((row) => row.next === row.old || picked.has(row.field.path))}
            onChange={(event) => setPicked(event.target.checked ? new Set(rows.filter((row) => row.next !== row.old).map((row) => row.field.path)) : new Set())} />{b.selectAll}</label>
          <ul className="grid gap-2">
            {rows.map(({ field, old, next }) => {
              const same = old === next;
              const direction = field.language === "ar" ? "rtl" : "ltr";
              return <li key={field.path} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[auto_1fr_1fr] sm:items-start">
                <label className="flex items-center gap-2 text-sm font-bold sm:col-span-3"><input className="accent-brand" type="checkbox" disabled={same} checked={!same && picked.has(field.path)} onChange={(event) => toggle(field.path, event.target.checked)} />
                  {t.fieldLabels(field)}{same && <span className="tag">{b.unchanged}</span>}</label>
                <span className="hidden sm:block" aria-hidden="true" />
                <div className="min-w-0"><p className="text-xs font-bold text-muted">{b.old}</p><p className="whitespace-pre-wrap text-sm text-muted" dir={direction}>{old || b.empty}</p></div>
                <div className="min-w-0"><p className="text-xs font-bold text-brand">{b.new}</p><p className="whitespace-pre-wrap text-sm font-medium" dir={direction}>{next}</p></div>
              </li>;
            })}
          </ul>
        </div>}
        <div className="flex flex-wrap gap-2">
          {!rows && <button type="button" className="button button-primary" disabled={pending || blocked || (cost !== undefined && total < cost)} onClick={generate}>{pending ? t.generating : error ? t.retry : b.generate}</button>}
          {rows && <>
            <button type="button" className="button button-primary" onClick={() => apply(true, false)}>{b.applyAll}</button>
            <button type="button" className="button button-secondary" onClick={() => apply(false, false)}>{b.applySelected}</button>
            <button type="button" className="button button-secondary" onClick={() => apply(false, true)}>{b.applySave}</button>
            <button type="button" className="button button-secondary" disabled={pending} onClick={generate}>{t.retry}</button>
          </>}
          <button type="button" className="button button-secondary" onClick={close}>{rows ? b.discard : t.cancel}</button>
        </div>
      </div>
    </dialog>
  </>;
}
