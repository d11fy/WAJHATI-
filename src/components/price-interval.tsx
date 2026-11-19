"use client";

/*
 * Monthly / yearly switch for the plan cards, in the style of 21st.dev's "Pricing with Monthly/Yearly Toggle". Both prices stay in the
 * server-rendered markup; this only decides which one is visible (CSS reads data-interval), so prices are never computed in the browser.
 */
import { useState, type ReactNode } from "react";

type Interval = "monthly" | "yearly";

export function PriceInterval({ labels, children }: { labels: { group: string; monthly: string; yearly: string; save: string | null }; children: ReactNode }) {
  const [interval, setInterval] = useState<Interval>("yearly");
  return <>
    <div className="wajhati-interval" role="radiogroup" aria-label={labels.group}>
      {(["monthly", "yearly"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={interval === value} className="wajhati-interval-option" onClick={() => setInterval(value)}>
        {labels[value]}{value === "yearly" && labels.save && <span className="wajhati-interval-save">{labels.save}</span>}
      </button>)}
    </div>
    <div className="wajhati-plan-cards" data-interval={interval}>{children}</div>
  </>;
}
