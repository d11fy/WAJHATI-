import { Coins, Instagram, Landmark, MessageCircle, QrCode, Smartphone, Wallet } from "lucide-react";
import type { Locale } from "@/lib/i18n";

/** Payment methods and order channels the platform really supports (see the pricing page). A scrolling strip in the style of 21st.dev's logo-cloud marquee. */
const items = [
  { icon: Landmark, ar: "بنك فلسطين", en: "Bank of Palestine" },
  { icon: Wallet, ar: "بال باي", en: "PalPay" },
  { icon: Smartphone, ar: "جوال باي", en: "Jawwal Pay" },
  { icon: Coins, ar: "USDT", en: "USDT" },
  { icon: Wallet, ar: "فودافون كاش", en: "Vodafone Cash" },
  { icon: MessageCircle, ar: "طلبات واتساب", en: "WhatsApp orders" },
  { icon: Instagram, ar: "طلبات إنستغرام", en: "Instagram orders" },
  { icon: QrCode, ar: "رمز QR لمتجرك", en: "QR code for your store" },
] as const;

export function ChannelMarquee({ locale }: { locale: Locale }) {
  const ar = locale === "ar";
  const row = (hidden: boolean) => <ul className="cm-row" aria-hidden={hidden || undefined}>
    {items.map(({ icon: Icon, ar: labelAr, en }) => <li key={en}><Icon size={18} aria-hidden="true" /><span>{ar ? labelAr : en}</span></li>)}
  </ul>;
  return <section className="cm" aria-label={ar ? "وسائل الدفع وقنوات الطلب المدعومة" : "Supported payment methods and order channels"}>
    <div className="cm-track">{[false, true].map((hidden) => <div className="cm-group" key={String(hidden)} aria-hidden={hidden || undefined}>{row(hidden)}{row(true)}</div>)}</div>
  </section>;
}
