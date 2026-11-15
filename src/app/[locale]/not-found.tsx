import Link from "next/link";
import { copy } from "@/lib/copy";

export default function NotFound() {
  return (
    <main className="shell py-16">
      <section className="panel p-8">
        <p className="tag">404</p>
        <h1 className="my-4 text-3xl font-black">
          <span lang="ar" className="hidden rtl:inline">{copy.ar.notFound}</span>
          <span lang="en" className="rtl:hidden">{copy.en.notFound}</span>
        </h1>
        <Link className="hidden rtl:inline-flex" href="/ar"><span className="button button-secondary">{copy.ar.goHome}</span></Link>
        <Link className="button button-secondary rtl:hidden" href="/en">{copy.en.goHome}</Link>
      </section>
    </main>
  );
}
