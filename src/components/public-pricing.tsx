import Link from "next/link";
import { Check, ArrowRight, CreditCard, Sparkles } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatPrice } from "@/lib/catalog";
import { defaultPlatformWhatsapp, formatWhatsappPhone, subscriptionContact } from "@/lib/platform-contact";
import type { PublishedPlan } from "@/server/billing/marketing";

export function PublicPricing({
  locale,
  catalog,
  requestedMarket,
  compact = false,
  whatsapp = defaultPlatformWhatsapp,
  trialDays = 3,
}: {
  locale: Locale;
  catalog: PublishedPlan[] | null;
  requestedMarket?: string;
  compact?: boolean;
  whatsapp?: string;
  trialDays?: number | null;
}) {
  const ar = locale === "ar";
  const markets = [...new Set(catalog?.map((price) => `${price.country}-${price.currency}`))];
  const market = requestedMarket ?? (markets.includes("PS-ILS") ? "PS-ILS" : markets[0]);
  const offers = catalog?.filter((offer) => `${offer.country}-${offer.currency}` === market) ?? [];
  const plans = [...new Set(offers.map((price) => price.plan))];
  const regions = new Intl.DisplayNames(locale, { type: "region" });
  const number = new Intl.NumberFormat(locale);
  const waActivate = whatsapp ? subscriptionContact(whatsapp, locale, { mode: "activate" }) : null;
  const waRenew = whatsapp ? subscriptionContact(whatsapp, locale, { mode: "renew" }) : null;
  const formattedPhone = whatsapp ? formatWhatsappPhone(whatsapp) : null;

  return <section id="pricing" className="wajhati-market-width wajhati-market-section premium-pricing" aria-labelledby="premium-pricing-title">
    <div className="premium-section-heading"><div><p className="wajhati-section-kicker">{ar ? "استثمار بسيط. مساحة أكبر لطموحك." : "A SMALL INVESTMENT. A BIGGER POSSIBILITY."}</p><h2 id="premium-pricing-title">{ar ? "باقة واحدة. كل الأدوات التي تحتاجها." : "One plan. Room for everything you do."}</h2></div><p>{ar ? `اختر الدفع الشهري أو السنوي. تجربة مجانية لمدة ${number.format(trialDays ?? 3)} أيام (72 ساعة) عند إنشاء الحساب، وتفعيل الاشتراك لكل متجر عبر واتساب.` : `Choose monthly or annual billing. Includes a ${number.format(trialDays ?? 3)}-day (72-hour) free trial at account creation, with per-store activation via WhatsApp.`}</p></div>
    {!compact && markets.length > 0 && <form className="premium-price-market" action={`/${locale}/pricing`}><label className="field">{ar ? "السوق وعملة الفوترة" : "Market and billing currency"}<select className="control" name="market" defaultValue={market}>{requestedMarket && !markets.includes(requestedMarket) && <option value={requestedMarket}>{ar ? "سوق غير متاح" : "Unavailable market"}</option>}{markets.map((key) => { const [country, currency] = key.split("-"); return <option key={key} value={key}>{regions.of(country)} · {currency}</option>; })}</select></label><button className="button button-secondary">{ar ? "عرض الأسعار" : "Show prices"}</button></form>}
    {!offers.length ? <div className="panel wajhati-pricing-empty"><CreditCard size={28} aria-hidden="true" /><h3>{catalog === null ? ar ? "تعذر تحميل الأسعار حاليًا" : "Prices are temporarily unavailable" : ar ? "لا توجد أسعار منشورة لهذا السوق حاليًا" : "No published prices for this market yet"}</h3><p>{ar ? "يمكنك استكشاف التصاميم والميزات الآن." : "You can explore the designs and features now."}</p><Link href={`/${locale}#themes`} className="button button-secondary">{ar ? "استكشف الثيمات" : "Explore themes"}</Link></div> : plans.map((plan) => {
      const prices = offers.filter((offer) => offer.plan === plan);
      const monthly = prices.find((offer) => offer.interval === "monthly");
      const yearly = prices.find((offer) => offer.interval === "yearly");
      const feature = prices[0];
      const savings = monthly && yearly ? monthly.amount * 12 - yearly.amount : 0;
      const features = [ar ? "متجر بهويتك ورابط خاص" : "Your branding and store link", ar ? "الثيمات الستة الأساسية" : "All six core themes",
        ...(feature.premium ? [ar ? "تخصيص الألوان والخطوط" : "Advanced colors and typography"] : []),
        ...(feature.luxury ? ["Luxury Boutique"] : []), ar ? "إدارة المنتجات والتصنيفات" : "Product and category management", ar ? "طلبات عبر واتساب وإنستغرام" : "WhatsApp and Instagram order handoff",
        ...(feature.analytics === "enhanced" ? [ar ? "تحليلات موسعة" : "Enhanced analytics"] : []),
        `${number.format(feature.maxProducts)} ${ar ? "منتج" : "products"}`, `${number.format(feature.storageMiB)} ${ar ? "ميبيبايت للتخزين" : "MiB storage"}`];
      return <div className="premium-price-layout" key={plan}><div className="premium-price-features"><span className="premium-plan-icon"><Sparkles size={24} aria-hidden="true" /></span><h3>{feature.name}</h3><p>{ar ? "ميزات متكاملة لإطلاق متجرك وإدارته." : "A complete toolkit to launch and manage your store."}</p><ul>{features.map((text) => <li key={text}><Check size={17} aria-hidden="true" />{text}</li>)}</ul></div><div className="premium-price-options">{[monthly, yearly].map((price, index) => <article className={`premium-price-card${index ? " premium-price-annual" : ""}`} key={index} data-offer={price ? "published" : "unavailable"}>
        <header><h3>{index ? ar ? "الاشتراك السنوي" : "Annual membership" : ar ? "الاشتراك الشهري" : "Monthly membership"}</h3>{index === 1 && savings > 0 && <span className="tag">{ar ? "وفّر" : "Save"} <bdi>{formatPrice(savings, feature.currency, locale)}</bdi></span>}</header>
        {price ? <><p className="premium-price-amount"><bdi>{formatPrice(price.amount, price.currency, locale)}</bdi><span>{index ? ar ? "للسنة كاملة" : "for the full year" : ar ? "للشهر" : "per month"}</span></p><p className="premium-price-market-label">{regions.of(price.country)} · <bdi>{price.currency}</bdi></p>{price.canPurchase ? <Link href={`/${locale}/sign-in`} className="button button-primary">{ar ? "سجّل الدخول للاشتراك" : "Sign in to subscribe"}<ArrowRight size={16} className="arrow" aria-hidden="true" /></Link> : <><button className="button button-secondary" disabled>{ar ? "الدفع غير متاح حاليًا" : "Payment not available yet"}</button><p className="premium-price-note">{ar ? "السعر معتمد. ستتاح الاشتراكات بعد تجهيز وسيلة الدفع." : "Published price. Subscriptions open once a payment method is configured."}</p></>}</> : <p>{ar ? "هذه الدورة غير متاحة حاليًا" : "This billing interval is not available"}</p>}
      </article>)}</div></div>;
    })}
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
