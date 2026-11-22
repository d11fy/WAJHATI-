import { Sparkles } from "lucide-react";
import Link from "next/link";
import { aiCopy } from "@/lib/ai-copy";
import type { Locale } from "@/lib/i18n";
import type { WalletView } from "@/server/ai/wallet-view";

/** "AI credits: 485 / 600" with a usage bar and the renewal date. Presentational only: the numbers come from the wallet function. */
export function CreditsMeter({ locale, slug, wallet, owner }: { locale: Locale; slug: string; wallet: WalletView; owner: boolean }) {
  const t = aiCopy[locale];
  const number = new Intl.NumberFormat(locale);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value));
  const hasCycle = wallet.kind !== null && wallet.allocation > 0;
  const total = wallet.balance + wallet.extra;
  const used = hasCycle ? Math.min(100, Math.round(((wallet.allocation - wallet.balance) / wallet.allocation) * 100)) : 0;
  const empty = total === 0;
  // While the assistant is switched off for the whole platform (or no provider key is set yet) merchants see nothing, not a dead card.
  if (wallet.reason === "disabled" || wallet.reason === "not_configured") return null;
  return <section className="panel mb-5 grid gap-3 p-5 sm:p-6" aria-labelledby="ai-credits-title" data-testid="ai-credits">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="ai-credits-title" className="flex items-center gap-2 text-xl font-black"><Sparkles size={20} className="text-brand" aria-hidden="true" />{t.brand}</h2>
      {wallet.kind === "trial" && <span className="tag">{t.meter.trial}</span>}
    </div>
    {wallet.reason === "suspended"
      ? <p className="text-sm text-muted">{t.meter.unavailable}</p>
      : <>
        <p className="text-lg font-black" data-testid="ai-credits-balance">{t.meter.title}: <bdi>{number.format(hasCycle ? wallet.balance : total)}{hasCycle && <> / {number.format(wallet.allocation)}</>}</bdi></p>
        {hasCycle && <div className="h-2 w-full overflow-hidden rounded-full bg-canvas" role="progressbar" aria-label={t.meter.usage} aria-valuemin={0} aria-valuemax={100} aria-valuenow={used}>
          <div className="h-full rounded-full bg-teal-700" style={{ width: `${used}%` }} />
        </div>}
        <p className="text-sm text-muted">
          {hasCycle && wallet.cycleEnd && <>{wallet.kind === "trial" ? t.meter.trialEnds : t.meter.renews} <bdi>{date(wallet.cycleEnd)}</bdi></>}
          {wallet.extra > 0 && <>{hasCycle ? " · " : ""}{t.meter.extra(wallet.extra)}</>}
          {!hasCycle && wallet.extra === 0 && t.meter.none}
        </p>
        {empty && <p className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-bold" role="status">
          <span className="font-normal">{t.outOfCredits}</span>
          {owner ? <Link className="underline" href={`/${locale}/dashboard/stores/${slug}/billing`}>{t.billingLink}</Link> : null}
        </p>}
      </>}
  </section>;
}
