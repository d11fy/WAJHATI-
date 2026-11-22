import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Globe2, Languages, Menu, MessageCircle, ShieldCheck, XCircle } from "lucide-react";
import bag from "@/assets/wajhati/bag.svg";
import check from "@/assets/wajhati/check.svg";
import credit from "@/assets/wajhati/credit.svg";
import grid from "@/assets/wajhati/grid.svg";
import message from "@/assets/wajhati/message.svg";
import spark from "@/assets/wajhati/spark.svg";
import { LegalLinks } from "@/components/legal-links";
import { Brand } from "@/components/site-header";
import { ProductPreview } from "@/components/product-preview";
import { HomeHero } from "@/components/home-hero";
import { ChannelMarquee } from "@/components/channel-marquee";
import { FaqList } from "@/components/faq-list";
import { ThemesMenu } from "@/components/themes-menu";
import { themeRegistry } from "@/lib/theme-config";
import { heroThemes } from "@/components/hero-themes";
import { ThemeShowcase } from "@/components/theme-showcase";
import { PublicPricing } from "@/components/public-pricing";
import { registrationAvailable } from "@/lib/billing";
import { copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { defaultPlatformWhatsapp, subscriptionContact } from "@/lib/platform-contact";
import { cachedContactSettings, cachedMarketingBilling, cachedPublicSignup } from "@/server/marketing-cache";

export type MarketingSection = "home" | "features" | "pricing" | "faq";
type Search = { [key: string]: string | string[] | undefined };
const icons = [bag, grid, spark, message, credit, check];
const strings = {
  ar: {
    description: "منصة إنشاء المتاجر الإلكترونية", nav: ["المميزات", "كيف تعمل", "الباقات", "الأسئلة الشائعة"], menu: "القائمة",
    headline: "متجرك الإلكتروني، هويتك أنت.", intro: "منصة واحدة لإنشاء متجرك، عرض منتجاتك، تخصيص هويتك، واستقبال طلبات العملاء عبر واتساب وإنستغرام.",
    start: "ابدأ إنشاء متجرك", explore: "اكتشف المميزات", values: ["هوية احترافية", "إدارة المنتجات", "طلبات المحادثات", "منصة عربية"],
    features: "كل أدوات تجارتك في مكان واحد", featuresNote: "صممت واجهتي لتسهّل البيع، لا لتضيف عليك خطوات جديدة.",
    featuresHero: "منصة تساعدك على البيع", featuresIntro: "الوظائف الأساسية التي يحتاجها التاجر العربي، بواجهة عملية ومتناسقة.",
    cards: [["أطلق متجرك بسهولة", "رابط خاص، هوية متكاملة وصفحات منتجات منظمة."], ["كتالوج بإدارة مريحة", "منتجات وأسعار وخيارات وصور من لوحة واحدة."], ["تحكّم في التصميم", "خصّص الشعار والألوان والبنرات والأقسام."], ["طلبات عبر المحادثات", "سلة واضحة تنقل ملخّص الطلب لوسيلة التواصل."], ["اشتراكات مرنة", "باقات شهرية وسنوية حيث تتوفر وسائل الدفع."], ["حماية لبيانات المتاجر", "صلاحيات مستقلة لكل متجر وتحقق عند مراجعة الدفع."]],
    compareKicker: "الفرق في تجربة البيع اليومية",
    compareTitle: "ودّع فوضى الرسائل المتكررة، واستقبل طلبات جاهزة.",
    compareBeforeTitle: "البيع العشوائي عبر المحادثات",
    compareBefore: [
      "الرد اليومي المتكرر على أسئلة الأسعار والمقاسات والتوفر.",
      "رسائل غير مكتملة وضياع طلبات العملاء وسط المحادثات.",
      "حساب يدوي مرهق للمجموع ومراجعة كل صنف من الصفر.",
      "غياب رابط متجر موحّد يعكس هوية علامتك التجارية.",
    ],
    compareAfterTitle: "البيع المنظم عبر واجهتي",
    compareAfter: [
      "كتالوج واضح يعرض الصور والأسعار والخيارات المتاحة فوراً.",
      "سلة ذكية تجمع الأصناف وترسل ملخصاً موثقاً برقم مرجعي.",
      "حساب آلي دقيق للمجموع محمّي من أي تلاعب بالأسعار.",
      "واجهة احترافية بشعارك وألوانك ورمز QR جاهز للمشاركة.",
    ],
    how: "من الفكرة لأول طلب بأربع خطوات", howNote: "ابدأ اليوم واترك كل التفاصيل في مكانها الصحيح.",
    steps: [["إنشاء حساب", "ابدأ بإعداد متجرك."], ["إضافة المنتجات", "أضف صورًا وأسعارًا وخيارات."], ["اختيار التصميم", "اختر مظهرًا يعكس هويتك."], ["استقبال الطلبات", "شارك الرابط وابدأ التواصل."]],
    plans: "باقات تكبر مع مشروعك", pricing: "باقات واضحة. إمكانيات حقيقية.", pricingNote: "اختر الخطة المناسبة لك. تختلف الأسعار وعروض الدفع حسب السوق.",
    choose: "عرض الباقات", market: "السوق والعملة", interval: "دورة الفوترة", monthly: "شهريًا", yearly: "سنويًا", apply: "عرض الأسعار", noMarket: "لا تتوفر عروض منشورة لهذا الاختيار حاليًا.", pricingUnavailable: "تعذر تحميل الأسعار الآن. حاول مجددًا لاحقًا.",
    products: "منتجًا", storage: "ميبيبايت للتخزين", analytics: "تحليلات موسعة", luxury: "تصميم Luxury Boutique", chat: "إدارة طلبات المحادثات",
    faq: "كل إجابة تحتاجها، في مكان واضح", faqIntro: "تعرّف على كيفية إنشاء متجرك والبيع وإدارة اشتراكك.",
    questions: [["هل أحتاج خبرة برمجية؟", "تدير متجرك والمنتجات والتصميم من لوحة التحكم."], ["كيف تصل طلبات العملاء إليّ؟", "يختار العميل قناة التواصل المفعّلة ويرسل ملخص سلة الطلب."], ["هل أستطيع تعديل المنتجات بعد نشرها؟", "نعم، يمكنك تعديلها من لوحة المتجر."], ["هل تختلف الميزات بين الشهري والسنوي؟", "الباقة الموحدة توفر الميزات نفسها في الدورتين. تعرض صفحة الأسعار المبلغ الكامل وحدود الاستخدام لكل عرض منشور."], ["هل أستطيع تغيير الباقة؟", "تراجع الخيارات المتاحة من صفحة الفوترة في متجرك."], ["هل يحتاج الزبون إلى حساب؟", "يمكن للعميل تصفح المتجر المنشور وإرسال الطلب عبر قناة التواصل المتاحة."], ["كيف يتم تفعيل الاشتراك أو تجديده؟", "يتواصل التاجر مع فريق واجهتي عبر واتساب الرسمي، ثم تفعّل إدارة المنصة الاشتراك للمتجر المحدد بعد تأكيد الدفعة."]],
    trust: ["بدون بطاقة بنكية للتسجيل", "طلبات عبر واتساب وإنستغرام", "عربي أولاً، وبلغتين"],
    closing: "متجرك يبدأ من واجهة واضحة.", accessClosed: "التسجيل العام غير متاح حاليًا. يمكن لأصحاب الحسابات تسجيل الدخول.",
    localAccess: "إنشاء حساب تجريبي", localNote: "التسجيل التجريبي متاح على هذا الجهاز فقط.",
    marketHelp: "تظهر الأسواق والعملات التي لديها عرض منشور وطريقة دفع نشطة. اختر دورة الفوترة لعرض السعر الكامل بتلك العملة.",
    noOffers: "لا توجد باقات منشورة في الأسواق المتاحة حاليًا.", unavailable: "غير متاحة", available: "عرض منشور",
    billingAccess: "سجّل الدخول لإدارة الاشتراك", workspaces: "مساحة عمل التاجر", quickGuide: "دليل البداية",
    whatsappSupport: "تواصل معنا عبر واتساب",
  },
  en: {
    description: "A platform for creating online stores", nav: ["Features", "How it works", "Pricing", "FAQ"], menu: "Menu",
    headline: "Your online store, your identity.", intro: "Create a store, showcase your products, customize your brand, and receive orders through WhatsApp and Instagram.",
    start: "Start your store", explore: "Explore features", values: ["Your own brand", "Product management", "Chat orders", "Arabic-first"],
    features: "Everything you need to run your store", featuresNote: "WAJHATI keeps selling straightforward.",
    featuresHero: "A platform that helps you sell", featuresIntro: "The essentials for online merchants, in one consistent workspace.",
    cards: [["Launch your store", "A dedicated link, your branding and organized product pages."], ["Manage your catalog", "Products, prices, options and photos in one dashboard."], ["Control your design", "Customize your logo, colors, banners and sections."], ["Orders through chat", "Send a clear cart summary to your selected contact channel."], ["Flexible subscriptions", "Monthly and annual offers where payment is available."], ["Protect store data", "Separate store permissions and verification for payment reviews."]],
    compareKicker: "THE DAILY SELLING DIFFERENCE",
    compareTitle: "Replace chaotic chat threads with structured orders.",
    compareBeforeTitle: "Unstructured DM Selling",
    compareBefore: [
      "Repeating prices, sizes, and availability in every chat.",
      "Incomplete messages and lost orders across threads.",
      "Manual total calculations and checking every item by hand.",
      "No unified storefront link representing your brand identity.",
    ],
    compareAfterTitle: "Structured Selling with WAJHATI",
    compareAfter: [
      "A clear catalog displaying photos, prices, and options upfront.",
      "Smart cart that prepares a verified order summary with a reference ID.",
      "Server-verified totals protected against price tampering.",
      "Branded storefront with your logo, colors, and print-ready QR code.",
    ],
    how: "Four steps from idea to first order", howNote: "Get started and keep the details in one place.",
    steps: [["Create an account", "Set up your store."], ["Add products", "Add photos, prices and options."], ["Choose a design", "Make the store feel like yours."], ["Receive orders", "Share your link and start a conversation."]],
    plans: "Plans that grow with your store", pricing: "Clear plans. Real features.", pricingNote: "Choose a plan for your store. Prices and payment availability vary by market.",
    choose: "See pricing", market: "Market and currency", interval: "Billing interval", monthly: "Monthly", yearly: "Yearly", apply: "Show prices", noMarket: "There are no published offers for this selection.", pricingUnavailable: "Prices are temporarily unavailable. Please check again later.",
    products: "products", storage: "MiB of storage", analytics: "Enhanced analytics", luxury: "Luxury Boutique theme", chat: "Chat order management",
    faq: "Find the answers you need", faqIntro: "Learn how to create a store, sell and manage your subscription.",
    questions: [["Do I need to code?", "Manage your store, products and design in the dashboard."], ["How do customers send orders?", "Customers choose an enabled contact channel and send a cart summary."], ["Can I edit products after publishing?", "Yes, from the merchant dashboard."], ["Do monthly and annual features differ?", "The unified plan includes the same features in both intervals. Pricing shows the full amount and usage limits for each published offer."], ["Can I change plans?", "Review available options in your store’s billing area."], ["Do customers need accounts?", "Visitors can browse a published store and send orders through an enabled channel."], ["How is my subscription activated or renewed?", "Contact the WAJHATI team via official WhatsApp; platform administration activates the subscription for your selected store after payment confirmation."]],
    trust: ["No bank card to sign up", "Orders via WhatsApp and Instagram", "Arabic-first, two languages"],
    closing: "Give your store a place of its own.", accessClosed: "Public registration is currently closed. Existing account holders can sign in.",
    localAccess: "Create a test account", localNote: "Test registration is available on this device only.",
    marketHelp: "Markets and currencies appear when a published offer and an active payment method are available. Choose a billing interval to see its full price in that currency.",
    noOffers: "There are no published plans in the available markets at the moment.", unavailable: "Unavailable", available: "Published offer",
    billingAccess: "Sign in to manage billing", workspaces: "Merchant workspace", quickGuide: "Getting started",
    whatsappSupport: "Contact us on WhatsApp",
  },
} as const;

export function marketingTitle(locale: Locale, section: Exclude<MarketingSection, "home">) {
  return strings[locale].nav[{ features: 0, pricing: 2, faq: 3 }[section]];
}

/** Page descriptions reuse the approved on-page copy so metadata never claims more than the page does. */
export function marketingDescription(locale: Locale, section: MarketingSection) {
  const t = strings[locale];
  return { home: t.intro, features: t.featuresIntro, pricing: t.pricingNote, faq: t.faqIntro }[section];
}

export async function Marketing({ locale, section, search = {} }: { locale: Locale; section: MarketingSection; search?: Search }) {
  const t = strings[locale];
  const ar = locale === "ar";
  const root = `/${locale}`;
  const alt = otherLocale(locale);
  const page = section === "home" ? "" : `/${section}`;
  const localSignup = registrationAvailable(process.env.APP_ORIGIN, process.env.DAR_LOCAL_SIGNUP);
  const publicSignup = await cachedPublicSignup();
  const signup = localSignup || publicSignup;
  const action = `${root}/${signup ? "sign-up" : "sign-in"}`;
  const actionLabel = localSignup ? t.localAccess : publicSignup ? t.start : copy[locale].signIn;
  const accessNote = localSignup ? t.localNote : publicSignup ? null : t.accessClosed;
  const links = [`${root}/features`, `${root}#how`, `${root}/pricing`, `${root}/faq`];
  const billing = section === "pricing" || section === "home" ? await cachedMarketingBilling() : null;
  const contact = section === "pricing" || section === "home" ? await cachedContactSettings() : null;
  const supportUrl = subscriptionContact(contact?.whatsapp ?? defaultPlatformWhatsapp, locale);
  const number = new Intl.NumberFormat(locale);
  const nav = <><Link href={`${root}#themes`}>{ar ? "الثيمات" : "Themes"}</Link>{t.nav.map((label, index) => <Link key={label} href={links[index]} aria-current={links[index] === root + page ? "page" : undefined}>{label}</Link>)}</>;
  return <div className={`wajhati-platform wajhati-marketing${section === "home" ? " wajhati-marketing-home" : ""}`}>
    <a className="sr-only focus:not-sr-only" href="#content">{ar ? "انتقل إلى المحتوى" : "Skip to content"}</a>
    <header className="wajhati-market-header"><nav className="wajhati-market-width" aria-label={t.menu}>
      <Brand locale={locale} /><div className="wajhati-market-links"><ThemesMenu label={ar ? "الثيمات" : "Themes"} all={{ href: `${root}#themes`, label: ar ? "عرض كل الثيمات" : "See all themes" }} themes={heroThemes(locale)} />{t.nav.map((label, index) => <Link key={label} href={links[index]} aria-current={links[index] === root + page ? "page" : undefined}>{label}</Link>)}</div>
      <div className="wajhati-market-actions"><Link href={`/${alt}${page}`} lang={alt} hrefLang={alt} aria-label={copy[locale].switchLanguage}><Globe2 size={18} aria-hidden="true" /></Link>
        <Link href={`${root}/sign-in`}>{copy[locale].signIn}</Link>{signup && <Link href={action} className="button wajhati-cta">{actionLabel}</Link>}
      </div>
      <details className="wajhati-mobile-nav"><summary aria-label={t.menu}><Menu size={23} aria-hidden="true" /></summary><div>{nav}<Link href={`/${alt}${page}`} lang={alt} hrefLang={alt}>{copy[locale].switchLanguage}</Link><Link href={`${root}/sign-in`}>{copy[locale].signIn}</Link>{supportUrl && <a href={supportUrl} target="_blank" rel="noopener noreferrer">{t.whatsappSupport}</a>}</div></details>
    </nav></header>
    <main id="content">
      {section === "home" ? <HomeHero locale={locale} startHref={action} startLabel={actionLabel} note={accessNote ?? (publicSignup && billing?.trialDays ? (ar ? `تجربة لمدة ${number.format(billing.trialDays)} أيام للحسابات المؤهلة` : `${number.format(billing.trialDays)}-day trial for eligible accounts`) : null)} copy={{ badge: t.description, title: ar ? ["تجارتك تستاهل", "واجهة تليق فيها."] : ["Your ambition.", "Your signature store."], intro: t.intro, explore: ar ? "استكشف التصاميم" : "Explore the designs", themesLabel: ar ? "اختر ثيمًا لترى المتجر" : "Pick a theme to preview the store", facts: t.trust }} themes={heroThemes(locale)} factIcons={[<ShieldCheck key="a" size={20} aria-hidden="true" />, <MessageCircle key="b" size={20} aria-hidden="true" />, <Languages key="c" size={20} aria-hidden="true" />]} /> : <section className={`wajhati-market-hero wajhati-${section}-hero`}>
        <div className="wajhati-market-width wajhati-hero-inner">
          <div>
            <h1>{section === "features" ? t.featuresHero : section === "pricing" ? t.pricing : t.faq}</h1>
            <p className="wajhati-hero-copy">{section === "features" ? t.featuresIntro : section === "pricing" ? t.pricingNote : t.faqIntro}</p>
            {section === "features" && <div className="wajhati-hero-actions"><Link href={action} className="button wajhati-cta">{actionLabel}<ArrowRight size={18} className="arrow" aria-hidden="true" /></Link></div>}
            {section === "features" && accessNote && <p className="wajhati-market-trial">{accessNote}</p>}
          </div>
        </div>
      </section>}
      {section === "home" && <ChannelMarquee locale={locale} />}
      {section === "home" && <ThemeShowcase locale={locale} />}
      {(section === "home" || section === "features") && <>
        <section className="wajhati-market-width wajhati-market-section" aria-label={t.features}>
          {section === "home" ? <>
            <div className="bento-head"><h2>{t.features}</h2><p>{t.featuresNote}</p><Link href={`${root}/features`} className="premium-text-link">{t.explore}<ArrowRight size={18} className="arrow" aria-hidden="true" /></Link></div>
            <div className="bento">
              <article className="bento-main"><div><h3>{t.cards[1][0]}</h3><p>{t.cards[1][1]}</p></div><ProductPreview locale={locale} /></article>
              <article className="bento-design"><div><h3>{t.cards[2][0]}</h3><p>{t.cards[2][1]}</p></div><ul className="bento-swatches" aria-hidden="true">{Object.values(themeRegistry).slice(2).map((theme) => <li key={theme.title} style={{ background: theme.colors.accent }} />)}</ul></article>
              <article className="bento-chat"><div><h3>{t.cards[3][0]}</h3><p>{t.cards[3][1]}</p></div><p className="bento-bubble"><strong>{ar ? "طلب جديد · رقم مرجعي" : "New order · reference number"}</strong><span>{ar ? "أصناف الطلب والخيارات والمجموع، جاهزة للإرسال" : "Items, options and total, ready to send"}</span><small>{ar ? "مثال توضيحي" : "Illustrative example"}</small></p></article>
              <article className="bento-safe"><span className="icon-tile"><ShieldCheck size={22} aria-hidden="true" /></span><div><h3>{t.cards[5][0]}</h3><p>{t.cards[5][1]}</p></div></article>
            </div>
          </> : <div className="wajhati-market-grid">{[0, 1, 2, 3, 4, 5].map((i) => <article className="panel" key={i}><span className="icon-tile"><Image src={icons[i]} alt="" unoptimized /></span><div><h3>{t.cards[i][0]}</h3><p>{t.cards[i][1]}</p></div></article>)}</div>}
        </section>
        <section className="wajhati-comparison" aria-labelledby="wajhati-compare-title">
          <div className="wajhati-market-width wajhati-market-section">
            <h2 id="wajhati-compare-title">{t.compareTitle}</h2>
            <div className="wajhati-comparison-grid">
              <article className="wajhati-comparison-card wajhati-comparison-before">
                <h3>{t.compareBeforeTitle}</h3>
                <ul>{t.compareBefore.map((item) => <li key={item}><XCircle size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>
              </article>
              <article className="wajhati-comparison-card wajhati-comparison-after">
                <h3>{t.compareAfterTitle}</h3>
                <ul>{t.compareAfter.map((item) => <li key={item}><CheckCircle2 size={18} aria-hidden="true" /><span>{item}</span></li>)}</ul>
              </article>
            </div>
          </div>
        </section>
        <section id="how" className="wajhati-how"><div className="wajhati-market-width wajhati-market-section"><h2>{t.how}</h2><p>{t.howNote}</p>
          <ol>{t.steps.map(([title, note], index) => <li key={title}><span>{number.format(index + 1)}</span><strong>{index === 0 && !signup ? copy[locale].signIn : title}</strong><p>{note}</p></li>)}</ol>
        </div></section>
      </>}
      {(section === "home" || section === "pricing") && <PublicPricing locale={locale} catalog={billing?.catalog ?? null} compact={section === "home"} requestedMarket={typeof search.market === "string" ? search.market : undefined} whatsapp={contact?.whatsapp} trialDays={billing?.trialDays} startHref={signup ? action : undefined} startLabel={signup ? actionLabel : undefined} />}
      {section === "home" && <section className="premium-setup wajhati-market-width"><span className="icon-tile"><Image src={spark} alt="" unoptimized /></span><div><h2>{ar ? "تفضّل أن نجهّز المتجر معك؟" : "Prefer a helping hand with setup?"}</h2><p>{ar ? "أنشئ متجرك بنفسك، أو اطلب خدمة التجهيز من لوحة متجرك عند توفرها. خدمة التجهيز منفصلة عن الاشتراك." : "Build it yourself, or request setup assistance from your store dashboard when available. Setup is separate from the subscription."}</p></div><div className="flex flex-wrap gap-2">{supportUrl && <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="button button-primary"><MessageCircle size={18} aria-hidden="true" />{t.whatsappSupport}</a>}<Link href={`${root}/sign-in`} className="button button-secondary">{ar ? "الدخول إلى لوحة المتجر" : "Open your dashboard"}</Link></div></section>}
      {(section === "faq" || section === "home") && <section className="wajhati-market-width wajhati-market-section wajhati-questions" aria-label={t.nav[3]}>{section === "home" && <h2>{t.faq}</h2>}<FaqList items={section === "home" ? t.questions.slice(0, 4) : t.questions} searchable={section === "faq"} labels={ar ? { search: "ابحث في الأسئلة", none: "لا توجد أسئلة مطابقة. جرّب كلمة أخرى.", link: "رابط السؤال" } : { search: "Search the questions", none: "No matching questions. Try another word.", link: "Link to this question" }} /></section>}
      {section === "home" && <section className="wajhati-market-closing"><div className="wajhati-market-width"><h2>{t.closing}</h2><div className="mt-4 flex flex-wrap justify-center gap-3"><Link className="button wajhati-cta" href={action}>{actionLabel}</Link>{supportUrl && <a className="button wajhati-hero-secondary" href={supportUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" />{t.whatsappSupport}</a>}</div></div></section>}
    </main>
    <footer className="wajhati-market-footer"><div className="wajhati-market-width"><div><Brand locale={locale} /><p>{t.description}</p></div>
      <nav aria-label={t.menu}>{nav}</nav><div><strong>{t.workspaces}</strong><p><Link href={`${root}/sign-in`}>{copy[locale].signIn}</Link></p>{supportUrl && <p className="mt-1"><a href={supportUrl} target="_blank" rel="noopener noreferrer">{t.whatsappSupport}</a></p>}<LegalLinks locale={locale} className="wajhati-footer-legal" /></div>
    </div></footer>
  </div>;
}
