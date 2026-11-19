import Link from "next/link";
import { ArrowRight, Check, Coins, CreditCard, Crown, Landmark, MessageCircle, Rocket, Smartphone, Upload, Wallet, X, BadgeCheck } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { PriceInterval } from "@/components/price-interval";
import { formatPrice } from "@/lib/catalog";
import { defaultPlatformWhatsapp, formatWhatsappPhone, subscriptionContact } from "@/lib/platform-contact";
import type { PublishedPlan } from "@/server/billing/marketing";

/** Payment methods the owner accepts. Transfer details are shown to the merchant inside the billing area, never on this public page. */
const paymentMethods = [
  { icon: Landmark, ar: "بنك فلسطين", en: "Bank of Palestine" },
  { icon: Wallet, ar: "بال باي", en: "PalPay" },
  { icon: Smartphone, ar: "جوال باي", en: "Jawwal Pay" },
  { icon: Coins, ar: "USDT", en: "USDT", viaWhatsapp: true },
  { icon: Wallet, ar: "فودافون كاش", en: "Vodafone Cash", viaWhatsapp: true },
] as const;

function gigabytes(mib: number, locale: Locale) {
  const value = mib / 1024;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

export function PublicPricing({
  locale,
  catalog,
  requestedMarket,
  compact = false,
  whatsapp = defaultPlatformWhatsapp,
  trialDays = 3,
  startHref,
  startLabel,
}: {
  locale: Locale;
  catalog: PublishedPlan[] | null;
  requestedMarket?: string;
  compact?: boolean;
  whatsapp?: string;
  trialDays?: number | null;
  startHref?: string;
  startLabel?: string;
}) {
  const ar = locale === "ar";
  const markets = [...new Set(catalog?.map((price) => `${price.country}-${price.currency}`))];
  const market = requestedMarket ?? (markets.includes("PS-ILS") ? "PS-ILS" : markets[0]);
  const offers = catalog?.filter((offer) => `${offer.country}-${offer.currency}` === market) ?? [];
  const plans = [...new Set(offers.map((price) => price.plan))].sort((a, b) => (a === "starter" ? -1 : 0) - (b === "starter" ? -1 : 0));
  const regions = new Intl.DisplayNames(locale, { type: "region" });
  const number = new Intl.NumberFormat(locale);
  const waActivate = whatsapp ? subscriptionContact(whatsapp, locale, { mode: "activate" }) : null;
  const waRenew = whatsapp ? subscriptionContact(whatsapp, locale, { mode: "renew" }) : null;
  const waPay = whatsapp ? subscriptionContact(whatsapp, locale, { mode: "activate" }) : null;
  const formattedPhone = whatsapp ? formatWhatsappPhone(whatsapp) : null;
  const best = Math.max(0, ...plans.map((plan) => {
    const monthly = offers.find((offer) => offer.plan === plan && offer.interval === "monthly");
    const yearly = offers.find((offer) => offer.plan === plan && offer.interval === "yearly");
    return monthly && yearly ? Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100) : 0;
  }));

  return <section id="pricing" className="wajhati-market-width wajhati-market-section premium-pricing" aria-labelledby="premium-pricing-title">
    <div className="premium-section-heading"><div><h2 id="premium-pricing-title">{ar ? "باقتان. والفرق واضح." : "Two plans. A clear difference."}</h2></div><p>{ar ? `اختر الدفع الشهري أو السنوي${best > 0 ? ` ووفّر حتى ${number.format(best)}٪ مع السنوي` : ""}. تجربة مجانية لمدة ${number.format(trialDays ?? 3)} أيام (72 ساعة) عند إنشاء الحساب، وتفعيل الاشتراك لكل متجر.` : `Choose monthly or annual billing${best > 0 ? ` and save up to ${number.format(best)}% with annual` : ""}. Includes a ${number.format(trialDays ?? 3)}-day (72-hour) free trial at account creation, with the subscription activated per store.`}</p></div>
    {!compact && markets.length > 0 && <form className="premium-price-market" action={`/${locale}/pricing`}><label className="field">{ar ? "السوق وعملة الفوترة" : "Market and billing currency"}<select className="control" name="market" defaultValue={market}>{requestedMarket && !markets.includes(requestedMarket) && <option value={requestedMarket}>{ar ? "سوق غير متاح" : "Unavailable market"}</option>}{markets.map((key) => { const [country, currency] = key.split("-"); return <option key={key} value={key}>{regions.of(country)} · {currency}</option>; })}</select></label><button className="button button-secondary">{ar ? "عرض الأسعار" : "Show prices"}</button></form>}
    {!offers.length ? <div className="panel wajhati-pricing-empty"><CreditCard size={28} aria-hidden="true" /><h3>{catalog === null ? ar ? "تعذر تحميل الأسعار حاليًا" : "Prices are temporarily unavailable" : ar ? "لا توجد أسعار منشورة لهذا السوق حاليًا" : "No published prices for this market yet"}</h3><p>{ar ? "يمكنك استكشاف التصاميم والميزات الآن." : "You can explore the designs and features now."}</p><Link href={`/${locale}#themes`} className="button button-secondary">{ar ? "استكشف الثيمات" : "Explore themes"}</Link></div> : <PriceInterval labels={{ group: ar ? "دورة الفوترة" : "Billing interval", monthly: ar ? "شهريًا" : "Monthly", yearly: ar ? "سنويًا" : "Yearly", save: best > 0 ? (ar ? `وفّر ${number.format(best)}٪` : `Save ${number.format(best)}%`) : null }}>{plans.map((plan) => {
      const prices = offers.filter((offer) => offer.plan === plan);
      const monthly = prices.find((offer) => offer.interval === "monthly");
      const yearly = prices.find((offer) => offer.interval === "yearly");
      const feature = prices[0];
      const pro = feature.premium || feature.luxury;
      const savings = monthly && yearly ? monthly.amount * 12 - yearly.amount : 0;
      const percent = monthly && yearly && savings > 0 ? Math.round((savings / (monthly.amount * 12)) * 100) : 0;
      const perMonth = yearly ? formatPrice(Math.round(yearly.amount / 12), yearly.currency, locale) : null;
      const rows: { text: string; included: boolean; strong?: boolean }[] = [
        { text: `${number.format(feature.maxProducts)} ${ar ? "منتج" : "products"}`, included: true, strong: true },
        { text: `${gigabytes(feature.storageMiB, locale)} ${ar ? "جيجابايت تخزين" : "GB storage"}`, included: true, strong: true },
        { text: ar ? "الثيمات الستة الأساسية" : "All six core themes", included: true },
        { text: ar ? "ثيم Luxury Boutique" : "Luxury Boutique theme", included: feature.luxury },
        { text: ar ? "تخصيص الألوان والخطوط والبنرات" : "Custom colors, fonts and banners", included: feature.premium },
        { text: feature.analytics === "enhanced" ? (ar ? "تحليلات موسّعة" : "Enhanced analytics") : (ar ? "تحليلات أساسية" : "Basic analytics"), included: true },
        { text: ar ? "طلبات عبر واتساب وإنستغرام" : "WhatsApp and Instagram orders", included: true },
        { text: ar ? "رابط خاص ورمز QR لمتجرك" : "Your own link and QR code", included: true },
      ];
      return <div className={`premium-price-layout${pro ? " is-featured" : ""}`} key={plan}>
        <div className="wajhati-plan-head">
          <span className="premium-plan-icon">{pro ? <Crown size={24} aria-hidden="true" /> : <Rocket size={24} aria-hidden="true" />}</span>
          <div><h3>{feature.name}</h3><p>{pro ? (ar ? "لتنمية متجرك بلا حدود تقريبًا." : "For growing your store with room to spare.") : (ar ? "للانطلاق بمتجر أنيق وجاهز." : "To launch a clean, ready store.")}</p></div>
          {pro && <span className="wajhati-plan-badge"><BadgeCheck size={14} aria-hidden="true" />{ar ? "الأنسب للنمو" : "Best for growth"}</span>}
        </div>
        <div className="premium-price-options">{[monthly, yearly].map((price, index) => <article className={`premium-price-card${index ? " premium-price-annual" : ""}`} key={index} data-interval={index ? "yearly" : "monthly"} data-offer={price ? "published" : "unavailable"}>
          <header><h3>{index ? ar ? "الاشتراك السنوي" : "Annual membership" : ar ? "الاشتراك الشهري" : "Monthly membership"}</h3>{index === 1 && savings > 0 && <span className="tag">{ar ? "وفّر" : "Save"} <bdi>{formatPrice(savings, feature.currency, locale)}</bdi>{percent > 0 && <> · <bdi>{number.format(percent)}%</bdi></>}</span>}</header>
          {price ? <><p className="premium-price-amount"><bdi>{formatPrice(price.amount, price.currency, locale)}</bdi><span>{index ? ar ? "للسنة كاملة" : "for the full year" : ar ? "للشهر" : "per month"}</span></p>{index === 1 && perMonth ? <p className="premium-price-market-label">{ar ? "ما يعادل" : "About"} <bdi>{perMonth}</bdi> {ar ? "شهريًا" : "per month"}</p> : <p className="premium-price-market-label">{regions.of(price.country)} · <bdi>{price.currency}</bdi></p>}{price.canPurchase ? <Link href={startHref ?? `/${locale}/sign-in`} className="button button-primary">{startLabel ?? (ar ? "سجّل الدخول للاشتراك" : "Sign in to subscribe")}<ArrowRight size={16} className="arrow" aria-hidden="true" /></Link> : <><button className="button button-secondary" disabled>{ar ? "الدفع غير متاح حاليًا" : "Payment not available yet"}</button><p className="premium-price-note">{ar ? "السعر معتمد. ستتاح الاشتراكات بعد تجهيز وسيلة الدفع." : "Published price. Subscriptions open once a payment method is configured."}</p></>}</> : <p>{ar ? "هذه الدورة غير متاحة حاليًا" : "This billing interval is not available"}</p>}
        </article>)}</div>
        <div className="premium-price-features"><ul>{rows.map((row) => <li key={row.text} className={row.included ? undefined : "is-excluded"}>{row.included ? <Check size={17} aria-hidden="true" /> : <X size={17} aria-hidden="true" />}<span className={row.strong ? "is-strong" : undefined}>{row.text}</span>{!row.included && <span className="sr-only">{ar ? " (غير متضمّن)" : " (not included)"}</span>}</li>)}</ul></div>
      </div>;
    })}</PriceInterval>}
    {offers.length > 0 && <div className="wajhati-payments" aria-labelledby="wajhati-payments-title">
      <div className="wajhati-payments-copy"><h3 id="wajhati-payments-title">{ar ? "طرق الدفع" : "Ways to pay"}</h3><p>{ar ? "الدفع خارج المنصة بالتحويل. ثم ترفع صورة الإشعار من لوحة اشتراكك، فتصلنا للمراجعة ونفعّل الاشتراك." : "You pay outside the platform by transfer, then upload the receipt from your billing page. It reaches us for review and we activate the subscription."}</p></div>
      <ul className="wajhati-pay-methods">{paymentMethods.map((method) => { const Icon = method.icon; return <li key={method.en}><Icon size={18} aria-hidden="true" /><span>{ar ? method.ar : method.en}</span>{"viaWhatsapp" in method && <small>{ar ? "عبر واتساب" : "via WhatsApp"}</small>}</li>; })}</ul>
      {!compact && <ol className="wajhati-pay-steps">
        <li><span><Landmark size={20} aria-hidden="true" /></span><strong>{ar ? "حوّل المبلغ" : "Transfer the amount"}</strong><p>{ar ? "تظهر بيانات التحويل في لوحة الاشتراك. لـ USDT وفودافون كاش نرسلها لك عبر واتساب." : "The transfer details appear in your billing page. For USDT and Vodafone Cash we send them on WhatsApp."}</p></li>
        <li><span><Upload size={20} aria-hidden="true" /></span><strong>{ar ? "ارفع الإشعار" : "Upload the receipt"}</strong><p>{ar ? "ارفع صورة إشعار التحويل من نفس الصفحة، وتصل مباشرة للوحة الإدارة." : "Upload a photo of the transfer receipt on the same page. It goes straight to the admin panel."}</p></li>
        <li><span><BadgeCheck size={20} aria-hidden="true" /></span><strong>{ar ? "نفعّل اشتراكك" : "We activate it"}</strong><p>{ar ? "نراجع الإشعار ونفعّل متجرك، أو تتواصل معنا مباشرة عبر واتساب." : "We review the receipt and activate your store, or you can message us directly on WhatsApp."}</p></li>
      </ol>}
      {waPay && <a href={waPay} target="_blank" rel="noopener noreferrer" className="button button-secondary wajhati-payments-whatsapp"><MessageCircle size={18} aria-hidden="true" />{ar ? "اسأل عن بيانات الدفع عبر واتساب" : "Ask for payment details on WhatsApp"}</a>}
    </div>}
    {waActivate && formattedPhone && (
      <div className="panel mt-6 flex flex-wrap items-center justify-between gap-4 p-5" data-testid="public-whatsapp-cta">
        <div className="grid gap-1">
          <h3 className="text-lg font-black">{ar ? "تفعيل أو تجديد اشتراك متجرك عبر واتساب" : "Activate or renew your store subscription via WhatsApp"}</h3>
          <p className="text-sm text-muted">
            {ar
              ? `تواصل مع فريق واجهتي على الرقم الرسمي (${formattedPhone}) لتفعيل أو تجديد اشتراك متجرك المحدد بعد إتمام الدفع.`
              : `Contact the official WAJHATI team on WhatsApp (${formattedPhone}) to activate or renew your selected store subscription.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={waActivate} target="_blank" rel="noopener noreferrer" className="button button-primary">
            {ar ? "تواصل معنا لتفعيل الاشتراك" : "Contact us to activate subscription"}
          </a>
          {waRenew && (
            <a href={waRenew} target="_blank" rel="noopener noreferrer" className="button button-secondary">
              {ar ? "تجديد الاشتراك عبر واتساب" : "Renew subscription via WhatsApp"}
            </a>
          )}
        </div>
      </div>
    )}
    {compact && offers.length > 0 && <Link className="premium-text-link" href={`/${locale}/pricing`}>{ar ? "تفاصيل الباقة والفوترة" : "Plan and billing details"}<ArrowRight className="arrow" size={17} aria-hidden="true" /></Link>}
  </section>;
}
