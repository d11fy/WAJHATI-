"use client";

import Link from "next/link";
import Image from "next/image";
import { ShoppingBag, Trash2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { formatPrice, type OptionGroup } from "@/lib/catalog";
import { demoCatalog } from "@/lib/demo-catalog";
import type { FamilyThemeId } from "@/lib/theme-config";
import type { Locale } from "@/lib/i18n";

type Line = { product: string; quantity: number; choice: string };
const key = (theme: string) => `wajhati-demo-v1:${theme}`;
const event = "wajhati-demo-cart";
function read(theme: string): Line[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(theme)) ?? "[]");
    return Array.isArray(value) ? value.slice(0, 20).filter((line): line is Line => Boolean(line && typeof line === "object" && /^item-[1-4]$/.test(line.product) && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 10 && typeof line.choice === "string" && line.choice.length < 80)) : [];
  } catch { return []; }
}
function save(theme: string, lines: Line[]) {
  try { localStorage.setItem(key(theme), JSON.stringify(lines)); window.dispatchEvent(new Event(event)); return true; } catch { return false; }
}
function subscribe(callback: () => void) { window.addEventListener(event, callback); window.addEventListener("storage", callback); return () => { window.removeEventListener(event, callback); window.removeEventListener("storage", callback); }; }
function useLines(theme: string) {
  const raw = useSyncExternalStore(subscribe, () => JSON.stringify(read(theme)), () => "[]");
  return JSON.parse(raw) as Line[];
}
export function DemoCartLink({ theme, locale }: { theme: FamilyThemeId; locale: Locale }) {
  const count = useLines(theme).reduce((sum, line) => sum + line.quantity, 0);
  return <Link className="store-cart-link" href={`/${locale}/demo/${theme}/cart`}><ShoppingBag size={18} aria-hidden="true" />{locale === "ar" ? "السلة" : "Cart"} <span>{count}</span></Link>;
}
export function DemoAddToCart({ theme, product, groups, locale }: { theme: FamilyThemeId; product: string; groups: OptionGroup[]; locale: Locale }) {
  const ar = locale === "ar";
  const [status, setStatus] = useState("");
  return <form className="store-options" onSubmit={(e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const choice = String(form.get("choice") ?? "");
    const lines = read(theme);
    const existing = lines.find((line) => line.product === product && line.choice === choice);
    if (existing && existing.quantity >= 10) { setStatus(ar ? "الحد الأقصى في الديمو 10 قطع." : "The demo limit is 10 items."); return; }
    if (!existing && lines.length >= 20) { setStatus(ar ? "السلة التجريبية ممتلئة." : "The demo cart is full."); return; }
    if (existing) existing.quantity += 1; else lines.push({ product, choice, quantity: 1 });
    const saved = save(theme, lines);
    setStatus(saved ? ar ? "أُضيف إلى السلة التجريبية" : "Added to the demo cart" : ar ? "يرجى السماح بالتخزين المحلي لتجربة السلة." : "Allow browser storage to try the cart.");
  }}>
    {groups.map((group) => <label key={group.name}>{group.name}<select name="choice">{group.values.map((value) => <option key={value}>{value}</option>)}</select></label>)}
    <button className="store-cta"><ShoppingBag size={18} aria-hidden="true" />{ar ? "أضف إلى السلة" : "Add to cart"}</button>
    <p role="status">{status}</p><small>{ar ? "تجربة فقط — لن يتم إرسال طلب أو تحصيل مبلغ." : "Demo only — no order is sent and no payment is taken."}</small>
  </form>;
}
export function DemoCart({ theme, locale }: { theme: FamilyThemeId; locale: Locale }) {
  const ar = locale === "ar";
  const lines = useLines(theme);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [complete, setComplete] = useState(false);
  const { products } = demoCatalog(theme, locale);
  const valid = lines.flatMap((line) => { const product = products.find((p) => p.slug === line.product && p.available); return product ? [{ ...line, detail: product }] : []; });
  const total = valid.reduce((sum, line) => sum + line.quantity * line.detail.priceMinor, 0);
  return <div className="demo-cart-layout">
    <div>{!ready ? <p role="status">{ar ? "تحميل السلة…" : "Loading cart…"}</p> : !valid.length ? <div className="store-empty"><ShoppingBag size={32} aria-hidden="true" /><h2>{ar ? "سلتك بانتظار اختياراتك" : "Your cart is ready for your favorites"}</h2><Link href={`/${locale}/demo/${theme}`}>{ar ? "تصفح المنتجات التجريبية" : "Explore the demo collection"}</Link></div> : <ul className="demo-cart-items">{valid.map((line) => <li key={`${line.product}:${line.choice}`}>
      <Image src={line.detail.imageSrc} alt="" width={100} height={100} /><div><Link href={`/${locale}/demo/${theme}/p/${line.product}`}>{ar ? line.detail.nameAr : line.detail.nameEn}</Link><p>{line.choice}</p><bdi>{formatPrice(line.detail.priceMinor, "ILS", locale)}</bdi><label>{ar ? "الكمية" : "Quantity"}<select aria-label={`${ar ? "الكمية" : "Quantity"} ${ar ? line.detail.nameAr : line.detail.nameEn}`} value={line.quantity} onChange={(e) => { save(theme, lines.map((item) => item.product === line.product && item.choice === line.choice ? { ...item, quantity: Number(e.target.value) } : item)); setComplete(false); }}>{Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label></div>
      <button type="button" aria-label={ar ? `حذف ${line.detail.nameAr}` : `Remove ${line.detail.nameEn}`} onClick={() => { save(theme, lines.filter((item) => !(item.product === line.product && item.choice === line.choice))); setComplete(false); }}><Trash2 size={18} /></button>
    </li>)}</ul>}</div>
    <aside className="store-detail-info"><h2>{ar ? "ملخّص تجريبي" : "Demo summary"}</h2><bdi className="store-price">{formatPrice(total, "ILS", locale)}</bdi><p>{ar ? "الأسعار والمنتجات للتوضيح فقط. في متجرك الفعلي يرسل العميل ملخص الطلب عبر وسيلة التواصل التي تفعّلها." : "Illustrative products and prices. In your real store, customers send a summary through your enabled contact channel."}</p><button className="store-cta" disabled={!valid.length || !ready} onClick={() => setComplete(true)}>{ar ? "جرّب تجهيز الطلب" : "Try preparing the order"}</button>{complete && <p role="status">{ar ? "ملخصك جاهز. هذه معاينة؛ لم يُرسل أي طلب ولم يتم تحصيل مبلغ." : "Your summary is ready. This is a preview; no order was sent and no payment was taken."}</p>}</aside>
  </div>;
}
