import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { Brand } from "@/components/site-header";
import type { Locale } from "@/lib/i18n";

/** Shown to visitors in place of a 404 when a published store is paused because its trial or subscription ended. */
export function PausedStore({ locale, name }: { locale: Locale; name: string }) {
  const ar = locale === "ar";
  return <main className="wajhati-platform grid min-h-screen place-items-center bg-canvas p-5">
    <section className="panel grid w-full max-w-lg justify-items-center gap-4 p-8 text-center" aria-labelledby="paused-title">
      <span className="icon-tile size-14"><PauseCircle size={28} aria-hidden="true" /></span>
      <h1 id="paused-title" className="wrap-anywhere text-2xl font-black"><bdi>{name}</bdi></h1>
      <p className="font-bold">{ar ? "هذا المتجر متوقف مؤقتًا" : "This store is temporarily paused"}</p>
      <p className="text-sm leading-7 text-muted">{ar ? "المتجر غير متاح للطلب حاليًا. يمكنك المحاولة لاحقًا أو التواصل مع صاحب المتجر مباشرة." : "The store is not taking orders right now. Please try again later or contact the store owner directly."}</p>
      <div className="grid w-full gap-2 border-t border-line pt-4">
        <p className="text-sm text-muted">{ar ? "هل أنت صاحب المتجر؟ سجّل الدخول إلى حسابك على المنصة لتفعيل الاشتراك وإعادة المتجر." : "Are you the owner? Sign in to your platform account to subscribe and bring the store back."}</p>
        <Link className="button button-primary justify-self-center" href={`/${locale}/sign-in`}>{ar ? "تسجيل الدخول" : "Sign in"}</Link>
      </div>
      <Brand locale={locale} />
    </section>
  </main>;
}
