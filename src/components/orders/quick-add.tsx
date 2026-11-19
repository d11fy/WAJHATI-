"use client";

/*
 * "Add to cart" straight from a product card. The card only knows the product's slug, so the option groups (size, color…) are fetched
 * when the shopper presses the button; products without options go straight into the cart. Totals are still verified on the server at checkout.
 */
import { ShoppingBag } from "lucide-react";
import { useState } from "react";
import type { OptionGroup } from "@/lib/catalog";
import { mergeCart } from "@/lib/checkout";
import type { Locale } from "@/lib/i18n";
import { orderCopy } from "@/lib/order-copy";
import { updateCart } from "./cart-store";

type Phase = "idle" | "loading" | "options" | "added" | "limit" | "error";

export function QuickAdd({ storeId, store, product, locale }: { storeId: string; store: string; product: string; locale: Locale }) {
  const t = orderCopy[locale];
  const ar = locale === "ar";
  const [phase, setPhase] = useState<Phase>("idle");
  const [groups, setGroups] = useState<OptionGroup[]>([]);

  const add = (options: { group: string; value: string }[]) => setPhase(updateCart(storeId, (lines) => mergeCart(lines, { product, quantity: 1, options })) ? "added" : "limit");

  async function start() {
    setPhase("loading");
    try {
      const response = await fetch(`/api/store-products/${store}/${product}`);
      const data = (await response.json()) as { available?: boolean; options?: OptionGroup[] };
      if (!response.ok || !data.available) return setPhase("error");
      if (data.options?.length) { setGroups(data.options); return setPhase("options"); }
      add([]);
    } catch { setPhase("error"); }
  }

  const message = phase === "added" ? t.added : phase === "limit" ? t.limit : phase === "error" ? (ar ? "تعذر تحميل خيارات المنتج. افتح صفحته وحاول مجددًا." : "Couldn’t load this product’s options. Open its page and try again.") : null;
  return <div className="store-quick">
    {phase === "options" ? <form className="store-options store-quick-options" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      add(groups.map((group, index) => ({ group: group.name, value: String(data.get(`option-${index}`) ?? "") })));
    }}>
      {groups.map((group, index) => <label key={group.name}><bdi>{group.name}</bdi>
        <select name={`option-${index}`} defaultValue="" required dir="auto"><option value="" disabled>{t.choose}</option>{group.values.map((value) => <option key={value}>{value}</option>)}</select>
      </label>)}
      <button className="store-quick-button" type="submit"><ShoppingBag size={16} aria-hidden="true" />{t.add}</button>
    </form> : <button className="store-quick-button" type="button" disabled={phase === "loading"} onClick={start}><ShoppingBag size={16} aria-hidden="true" />{t.add}</button>}
    {message && <p className="store-quick-note" role="status">{message}</p>}
  </div>;
}
