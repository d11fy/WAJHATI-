"use client";

import { ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatPrice, localizedValue, type OptionGroup } from "@/lib/catalog";
import { changeQuantity, lineKey, lineTotal, maxQuantity, mergeCart, orderMessage, type Channel, type Quote } from "@/lib/checkout";
import type { Locale } from "@/lib/i18n";
import { orderCopy } from "@/lib/order-copy";
import { updateCart, useCart } from "./cart-store";

type Props = { storeId: string; slug: string; locale: Locale };

export function CartLink({ storeId, slug, locale, accepting }: Props & { accepting: boolean }) {
  const count = useCart(storeId).reduce((sum, line) => sum + line.quantity, 0);
  if (!accepting && !count) return null;
  return <Link className="store-cart-link" href={`/${locale}/s/${slug}/cart`}>
    <ShoppingBag size={17} aria-hidden="true" /><span>{orderCopy[locale].cart}</span><bdi className="store-cart-count">{new Intl.NumberFormat(locale).format(count)}</bdi>
  </Link>;
}

export function AddToCart({ storeId, product, groups, locale }: { storeId: string; product: string; groups: OptionGroup[]; locale: Locale }) {
  const t = orderCopy[locale];
  const [notice, setNotice] = useState<"added" | "limit" | null>(null);
  return <form className="store-options" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const options = groups.map((group, i) => ({ group: group.name, value: String(data.get(`option-${i}`) ?? "") }));
    if (options.some((option) => !option.value)) return;
    const quantity = Number(data.get("quantity"));
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) return;
    setNotice(updateCart(storeId, (items) => mergeCart(items, { product, quantity, options })) ? "added" : "limit");
  }}>
    {groups.map((group, i) => <label key={group.name}><bdi>{group.name}</bdi><select aria-label={group.name} name={`option-${i}`} defaultValue="" required dir="auto">
      <option value="" disabled>{t.choose}</option>{group.values.map((value) => <option key={value}>{value}</option>)}
    </select></label>)}
    <label>{t.quantity}<input className="store-cart-quantity" type="number" name="quantity" min="1" max={maxQuantity} defaultValue="1" required /></label>
    <button className="store-cta justify-self-start" type="submit"><ShoppingBag size={18} aria-hidden="true" />{t.add}</button>
    {notice && <p role="status">{t[notice]}</p>}
  </form>;
}

type Intent = { id: string; reference: string; message: string; short: boolean; channel: Channel; version: string };
type Failure = { code?: keyof typeof orderCopy.en; quote?: Quote };

function requestId(storeId: string, version: string, channel: Channel, locale: Locale) {
  const key = `dar-order:v1:${storeId}:${channel}:${locale}`;
  const signature = `${version}:${channel}:${locale}`;
  const id = crypto.randomUUID();
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (saved?.signature === signature && /^[0-9a-f-]{36}$/.test(saved.id)) return saved.id as string;
    sessionStorage.setItem(key, JSON.stringify({ signature, id }));
  } catch { /* Checkout still works when browser storage is unavailable. */ }
  return id;
}

export function CartReview({ storeId, slug, locale }: Props) {
  const t = orderCopy[locale];
  const items = useCart(storeId);
  const [refresh, setRefresh] = useState(0);
  const [review, setReview] = useState<{ items: typeof items; refresh: number; quote: Quote | null; error?: keyof typeof t } | null>(null);
  const [selection, setSelection] = useState<Channel | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [error, setError] = useState<keyof typeof t | null>(null);
  const [copied, setCopied] = useState<"copied" | "manualCopy" | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const attempts = useRef(new Map<string, string>());
  const textarea = useRef<HTMLTextAreaElement>(null);
  const endpoint = `/api/checkout/${slug}`;
  const home = `/${locale}/s/${slug}`;

  useEffect(() => {
    if (!items.length) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", items, locale }), signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        setReview(response.ok ? { items, refresh, quote: data as Quote } : { items, refresh, quote: null, error: data.code ?? "failed" });
      } catch { if (!controller.signal.aborted) setReview({ items, refresh, quote: null, error: "failed" }); }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, items, locale, refresh]);

  const current = review?.items === items && review.refresh === refresh ? review : null;
  const quote = current?.quote;
  const channel = selection && quote?.channels.includes(selection) ? selection : quote?.defaultChannel;
  const prepared = intent && intent.version === quote?.version && intent.channel === channel ? intent : null;
  const valid = Boolean(quote?.rows.length && quote.rows.every((row) => row.line));

  async function send(action: "begin" | "open") {
    if (!quote || !channel || !valid || lock.current) return;
    if (action === "open" && !prepared) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setCopied(null);
    const signature = `${quote.version}:${channel}:${locale}`;
    const id = prepared?.id ?? attempts.current.get(signature) ?? requestId(storeId, quote.version, channel, locale);
    attempts.current.set(signature, id);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "begin"
        ? { action, id, items, locale, channel, version: quote.version }
        : { action, id, reference: prepared?.reference }) });
      const data = await response.json();
      if (!response.ok) {
        const failure = data as Failure;
        setError(failure.code ?? "failed");
        if (failure.quote) setReview({ items, refresh, quote: failure.quote });
        if (failure.code === "stale" || failure.code === "disabled") setIntent(null);
        if (failure.code === "stale" && !failure.quote) setRefresh((value) => value + 1);
        return;
      }
      if (action === "open") {
        const target = new URL(data.url);
        if (target.protocol !== "https:" || target.host !== (channel === "whatsapp" ? "wa.me" : "www.instagram.com")) throw new Error("Unexpected contact destination");
        window.location.assign(target.href);
      } else setIntent({ id, reference: data.reference, message: data.message, short: data.short, channel, version: quote.version });
    } catch { setError("failed"); }
    finally { lock.current = false; setBusy(false); }
  }

  if (!items.length) return <div className="store-empty"><p>{t.empty}</p><Link href={home}>{t.browse}</Link></div>;
  const money = (amount: number) => quote ? formatPrice(amount, quote.currency, locale) : "";
  const message = prepared?.message ?? (quote && valid ? orderMessage({ ...quote, locale, greeting: channel === "whatsapp" ? quote.greeting : "", lines: quote.rows.flatMap(({ line }) => line ? [line] : []) }) : "");

  return <>
    <div className="store-cart-toolbar"><p>{t.pendingConfirmation}</p><button type="button" className="store-cart-action" disabled={busy} onClick={() => { setError(null); setRefresh((value) => value + 1); }}>{t.refresh}</button></div>
    {(error || current?.error) && <p role="alert" className="store-cart-feedback">{t[(error ?? current?.error)!] ?? t.failed}</p>}
    {!current && <p role="status" className="store-cart-feedback">{t.loading}</p>}
    {current?.error && <ul className="store-cart-items">
      {items.map((item) => <li className="store-cart-toolbar store-cart-item" key={lineKey(item)}>
        <bdi>{item.product} × {item.quantity}</bdi>
        <button type="button" className="store-cart-action" onClick={() => updateCart(storeId, (lines) => changeQuantity(lines, lineKey(item), 0))}>{t.remove}</button>
      </li>)}
    </ul>}
    {quote && <div className="store-cart-layout">
      <ul className="store-cart-items">
        {quote.rows.map(({ key, input, line, issue }) => <li className="store-cart-item" key={key}>
          {line?.imageId && <div className="store-cart-photo"><Image unoptimized fill alt="" src={`/api/store-media/${slug}/${line.imageId}`} /></div>}
          <div className="store-cart-line">
            <h2><Link href={`${home}/p/${input.product}`}><bdi>{line ? localizedValue(locale, line.nameAr, line.nameEn) : input.product}</bdi></Link></h2>
            {input.options.length > 0 && <p className="flex flex-wrap gap-x-3 gap-y-1">{input.options.map(({ group, value }) => <bdi key={group}>{group} · {value}</bdi>)}</p>}
            {issue && <p role="status">{t[issue]}</p>}
            {line && <dl><div><dt>{t.unitPrice}</dt><dd><bdi>{money(line.unitMinor)}</bdi></dd></div><div><dt>{t.lineTotal}</dt><dd><bdi>{money(lineTotal(line))}</bdi></dd></div></dl>}
            <div className="store-cart-toolbar">
              <label>{t.quantity} <select className="store-cart-quantity" value={input.quantity} disabled={busy || Boolean(issue)} onChange={(event) => { setError(null); updateCart(storeId, (lines) => changeQuantity(lines, key, Number(event.target.value))); }}>
                {Array.from({ length: maxQuantity }, (_, i) => i + 1).map((value) => <option key={value}>{value}</option>)}
              </select></label>
              <button type="button" className="store-cart-action" disabled={busy} onClick={() => { setError(null); updateCart(storeId, (lines) => changeQuantity(lines, key, 0)); }}>{t.remove}</button>
            </div>
          </div>
        </li>)}
      </ul>
      <section className="store-cart-summary" aria-label={t.total}>
        <div className="store-cart-total"><h2>{t.total} <bdi>({quote.currency})</bdi></h2><bdi>{valid ? money(quote.total) : "—"}</bdi></div>
        <p dir="auto">{quote.instructions}</p>
        {!quote.channels.length ? <p role="status">{t.disabled}</p> : <fieldset className="store-cart-channels" disabled={busy}>
          <legend>{t.pickChannel}</legend>
          {quote.channels.map((value) => <label key={value}><input type="radio" name="channel" checked={channel === value} onChange={() => { setSelection(value); setError(null); setCopied(null); }} /> {t[value]}</label>)}
        </fieldset>}
        {prepared && <p><strong>{t.reference}</strong> <bdi>{prepared.reference}</bdi></p>}
        {message && <label className="store-cart-message">{t.preview}<textarea ref={textarea} readOnly dir="auto" value={message} rows={7} /></label>}
        {!prepared && <button className="store-cta" type="button" disabled={!channel || !valid || busy} onClick={() => void send("begin")}>{busy ? t.busy : t.prepare}</button>}
        {prepared && <>
          <p>{channel === "instagram" ? t.instagramHint : prepared.short ? t.shortHint : t.whatsappHint}</p>
          <div className="store-cart-toolbar">
            <button className="store-cart-action" type="button" disabled={busy} onClick={async () => {
              try { await navigator.clipboard.writeText(prepared.message); setCopied("copied"); }
              catch { textarea.current?.focus(); textarea.current?.select(); setCopied("manualCopy"); }
            }}>{t.copy}</button>
            <button className="store-cta" type="button" disabled={busy} onClick={() => void send("open")}>{busy ? t.busy : channel === "instagram" ? t.openInstagram : t.openWhatsapp}</button>
          </div>
          {copied && <p role="status">{t[copied]}</p>}
        </>}
      </section>
    </div>}
  </>;
}
