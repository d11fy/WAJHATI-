import { Globe2 } from "lucide-react";
import Link from "next/link";
import { LegalLinks } from "@/components/legal-links";
import { Brand } from "@/components/site-header";
import { copy } from "@/lib/copy";
import { otherLocale, type Locale } from "@/lib/i18n";
import { gapsUsed, legalApproved, legalDocs, legalUi, legalUpdated, legalVersion, parts, supportEmail, type Block, type LegalKind } from "@/lib/legal";
import { defaultPlatformWhatsapp, formatWhatsappPhone } from "@/lib/platform-contact";
import { contactSettings } from "@/server/platform/contact";

type Contact = { digits: string; display: string };

function Inline({ text, locale, contact }: { text: string; locale: Locale; contact: Contact }) {
  const values = { EMAIL: supportEmail, WHATSAPP: contact.display };
  return <>{parts(text, locale, values).map((part, index) => {
    if (typeof part === "string") return part;
    if ("gap" in part) return <mark key={index} className="wajhati-legal-gap" data-owner-review={part.gap}>{part.label}</mark>;
    if (part.value === "EMAIL") return <a key={index} href={`mailto:${supportEmail}`} dir="ltr">{supportEmail}</a>;
    return <a key={index} href={`https://wa.me/${contact.digits}`} target="_blank" rel="noopener noreferrer" dir="ltr">{contact.display}</a>;
  })}</>;
}

function Blocks({ blocks, locale, contact }: { blocks: Block[]; locale: Locale; contact: Contact }) {
  return <>{blocks.map((block, index) => {
    if ("p" in block) return <p key={index}><Inline text={block.p} locale={locale} contact={contact} /></p>;
    if ("ul" in block) return <ul key={index}>{block.ul.map((item) => <li key={item}><Inline text={item} locale={locale} contact={contact} /></li>)}</ul>;
    const { head, rows } = block.table;
    return <table key={index} className="wajhati-legal-table">
      <thead><tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, column) => column === 0
        ? <th key={column} scope="row" data-label={head[column]}><Inline text={cell} locale={locale} contact={contact} /></th>
        : <td key={column} data-label={head[column]}><Inline text={cell} locale={locale} contact={contact} /></td>)}</tr>)}</tbody>
    </table>;
  })}</>;
}

export async function LegalPage({ locale, kind }: { locale: Locale; kind: LegalKind }) {
  const doc = legalDocs[kind][locale];
  const t = legalUi[locale];
  const alt = otherLocale(locale);
  const root = `/${locale}`;
  const settings = await contactSettings();
  const raw = settings?.whatsapp ?? defaultPlatformWhatsapp;
  const contact: Contact = { digits: raw.replace(/\D/g, ""), display: formatWhatsappPhone(raw) };
  const approved = legalApproved();
  const gaps = gapsUsed(doc).length;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  return <div className="wajhati-platform wajhati-marketing wajhati-legal">
    <a className="sr-only focus:not-sr-only" href="#content">{locale === "ar" ? "انتقل إلى المحتوى" : "Skip to content"}</a>
    <header className="wajhati-market-header"><nav className="wajhati-market-width" aria-label={t.legal}>
      <Brand locale={locale} />
      <div className="wajhati-market-links"><Link href={root}>{locale === "ar" ? "الرئيسية" : "Home"}</Link><Link href={`${root}/pricing`}>{locale === "ar" ? "الباقات" : "Pricing"}</Link></div>
      <div className="wajhati-market-actions"><Link href={`/${alt}/${kind}`} lang={alt} hrefLang={alt} aria-label={copy[locale].switchLanguage}><Globe2 size={18} aria-hidden="true" /></Link>
        <Link href={`${root}/sign-in`}>{copy[locale].signIn}</Link></div>
    </nav></header>
    <main id="content" className="wajhati-legal-main">
      {!approved && <aside className="wajhati-legal-draft" role="note" aria-labelledby="legal-draft-title">
        <strong id="legal-draft-title">{t.draftTitle}</strong>
        <p>{t.draftBody}{gaps > 0 && <> ({locale === "ar" ? `${gaps} بنود مفتوحة` : `${gaps} open items`})</>}</p>
      </aside>}
      <article>
        <header className="wajhati-legal-head">
          <h1>{doc.title}</h1>
          <p className="wajhati-legal-meta"><span>{t.updated}: <time dateTime={legalUpdated}>{format.format(new Date(legalUpdated))}</time></span><span>{t.version}: {legalVersion}</span></p>
          <p className="wajhati-legal-summary">{doc.summary}</p>
        </header>
        <nav className="wajhati-legal-toc" aria-labelledby="legal-toc-title">
          <h2 id="legal-toc-title">{t.contents}</h2>
          <ol>{doc.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}</ol>
        </nav>
        {doc.sections.map((section) => <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`}>
          <h2 id={`${section.id}-title`}>{section.heading}</h2>
          <Blocks blocks={section.blocks} locale={locale} contact={contact} />
        </section>)}
      </article>
    </main>
    <footer className="wajhati-market-footer"><div className="wajhati-market-width">
      <div><Brand locale={locale} /><p>{supportEmail}</p></div>
      <LegalLinks locale={locale} />
      <div><strong>{copy[locale].brand}</strong><p><Link href={`${root}/sign-in`}>{copy[locale].signIn}</Link></p></div>
    </div></footer>
  </div>;
}
