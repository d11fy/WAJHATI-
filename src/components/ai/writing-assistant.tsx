"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import { aiCommands, aiField, aiTones, type AiCommand, type AiTone } from "@/lib/ai/fields";
import { aiCopy } from "@/lib/ai-copy";
import type { Locale } from "@/lib/i18n";
import { aiAssist, aiWalletStatus } from "@/server/ai/actions";
import type { WalletView } from "@/server/ai/wallet-view";

type Props = {
  locale: Locale; slug: string; fieldId: string; value: string;
  /** The text of the same field in the other language. Enables "translate". */
  siblingValue?: string;
  context?: { productName?: string; category?: string; notes?: string };
  onApply: (text: string) => void;
};

/**
 * Reusable "write with AI" control for one marketing text field. It opens a dialog where the merchant picks a command, sees the price and
 * the balance first, previews the result, and chooses to use, retry or cancel. Nothing reaches the field until "Use this text".
 * The server decides everything that matters (ownership, subscription, balance, limits); this component only presents it.
 */
export function AIWritingAssistant({ locale, slug, fieldId, value, siblingValue = "", context, onApply }: Props) {
  const t = aiCopy[locale];
  const field = aiField(fieldId);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [wallet, setWallet] = useState<WalletView | null | undefined>(undefined);
  const [command, setCommand] = useState<AiCommand>("improve");
  const [tone, setTone] = useState<AiTone>("professional");
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [pending, start] = useTransition();
  const run = useRef(0);
  if (!field) return null;

  const hasText = value.trim().length > 0;
  const hasSource = siblingValue.trim().length > 0;
  const allowed = (item: AiCommand) => item === "write" || (item === "translate" ? hasSource : hasText);
  const cost = wallet?.costs[field.operation];
  const total = wallet ? wallet.balance + wallet.extra : 0;
  const language = field.language === "ar" ? "rtl" : "ltr";
  const billing = `/${locale}/dashboard/stores/${slug}/billing`;

  function open() {
    setOptions([]); setError(null); setOutOfCredits(false);
    setCommand(hasText ? "improve" : "write");
    dialog.current?.showModal();
    void aiWalletStatus(locale, slug).then(setWallet).catch(() => setWallet(null));
  }

  function close() { run.current++; dialog.current?.close(); }

  function generate() {
    setError(null); setOutOfCredits(false); setOptions([]);
    const ticket = ++run.current;
    start(async () => {
      const result = await aiAssist(locale, slug, {
        fieldId, command, ...(command === "tone" ? { tone } : {}), text: command === "translate" ? siblingValue : value, ...(context ? { context } : {}), key: crypto.randomUUID(),
      }).catch(() => null);
      if (ticket !== run.current) return;
      if (!result) { setError(t.errors.unavailable); return; }
      if (!result.ok) {
        setError(t.errors[result.error]);
        setOutOfCredits(result.error === "insufficient" || result.error === "no_plan");
        return;
      }
      setOptions(result.options);
      setWallet((current) => current ? { ...current, balance: result.balance, extra: result.extra } : current);
    });
  }

  const blocked = wallet === undefined ? false : !wallet || !wallet.available;
  const reason = wallet && !wallet.available ? wallet.reason : null;
  const canRun = !pending && !blocked && allowed(command) && (cost === undefined || total >= cost);

  return <>
    <button type="button" className="button button-secondary min-h-9 gap-1.5 px-3 text-sm" onClick={open}>
      <Sparkles size={16} aria-hidden="true" />{t.open}
    </button>
    <dialog ref={dialog} aria-labelledby={titleId} className="panel fixed inset-0 m-auto max-h-[92vh] w-[min(94vw,36rem)] overflow-auto p-5 backdrop:bg-ink/40">
      <div className="grid gap-4">
        <div>
          <h3 id={titleId} className="flex items-center gap-2 text-lg font-black"><Sparkles size={18} className="text-brand" aria-hidden="true" />{t.title}</h3>
          <p className="mt-1 text-xs text-muted">{t.reviewNote}</p>
        </div>
        {wallet === null && <p className="error" role="alert">{t.meter.unavailable}</p>}
        {reason && <p className="error" role="alert">{reason === "no_plan" ? t.errors.no_plan : reason === "not_configured" ? t.errors.not_configured : reason === "suspended" ? t.errors.suspended : t.errors.disabled}</p>}
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="mb-1 text-sm font-bold">{t.command}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.command}>
            {aiCommands.map((item) => <button key={item} type="button" role="radio" aria-checked={command === item} disabled={!allowed(item)}
              title={item === "translate" && !hasSource ? t.translateNeedsSource : !allowed(item) ? t.nothingToWork : undefined}
              className="button button-secondary min-h-9 px-3 text-sm aria-checked:border-brand aria-checked:bg-leaf aria-checked:ring-2 aria-checked:ring-brand disabled:opacity-50"
              onClick={() => { setCommand(item); setOptions([]); setError(null); }}>{t.commands[item]}</button>)}
          </div>
          {command === "tone" && <label className="field">{t.tone}
            <select className="control" value={tone} onChange={(event) => setTone(aiTones.find((item) => item === event.target.value) ?? "professional")}>
              {aiTones.map((item) => <option key={item} value={item}>{t.tones[item]}</option>)}
            </select>
          </label>}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-leaf px-3 py-2 text-sm" aria-live="polite">
          <span><strong>{t.cost}:</strong> {cost === undefined ? "…" : t.costUnit(cost)}</span>
          <span><strong>{t.balance}:</strong> <bdi>{wallet ? total : "…"}</bdi></span>
        </div>
        <p className="-mt-2 text-xs text-muted">{t.chargeNote}</p>
        {error && <div className="error grid gap-2" role="alert">
          <p>{error}</p>
          {outOfCredits && <p className="flex flex-wrap items-center gap-3 font-bold"><span className="font-normal">{t.outOfCredits}</span><Link className="underline" href={billing}>{t.billingLink}</Link></p>}
        </div>}
        {pending && <p role="status" className="text-sm font-bold text-brand">{t.generating}</p>}
        {options.length > 0 && <div className="grid gap-2" aria-label={t.preview}>
          <p className="text-sm font-bold">{t.preview}</p>
          <ul className="grid gap-2">
            {options.map((option, index) => <li key={index} className="grid gap-2 rounded-xl border border-brand/40 bg-white p-3">
              <p className="whitespace-pre-wrap text-sm" dir={language}>{option}</p>
              <button type="button" className="button button-primary min-h-9 justify-self-start px-3 text-sm" onClick={() => { onApply(option); close(); }}>{t.use}</button>
            </li>)}
          </ul>
        </div>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="button button-primary" disabled={!canRun} onClick={generate}>{pending ? t.generating : options.length || error ? t.retry : t.generate}</button>
          <button type="button" className="button button-secondary" onClick={close}>{t.cancel}</button>
        </div>
      </div>
    </dialog>
  </>;
}
