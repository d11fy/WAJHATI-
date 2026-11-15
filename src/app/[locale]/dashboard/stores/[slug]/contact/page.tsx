import { notFound } from "next/navigation";
import { CatalogFrame } from "@/components/catalog/catalog-ui";
import { ContactForm } from "@/components/orders/merchant-forms";
import { orderCopy } from "@/lib/order-copy";
import { requireUser } from "@/server/auth/session";
import { routeLocale } from "@/server/locale";
import { getOrderSettings } from "@/server/orders/merchant";

export default async function ContactPage({ params, searchParams }: PageProps<"/[locale]/dashboard/stores/[slug]/contact">) {
  const locale = await routeLocale(params);
  const { slug } = await params;
  const user = await requireUser(locale);
  const data = await getOrderSettings(user.id, slug);
  if (!data) notFound();
  const t = orderCopy[locale];
  return <CatalogFrame locale={locale} slug={slug} path="/contact" storeName={data.store.name} showBilling={data.store.role === "owner"}>
    <h1 className="mb-5 text-balance text-3xl font-black">{t.contact}</h1>
    {(await searchParams).saved === "1" && <p className="tag mb-4" role="status">{t.saved}</p>}
    <ContactForm locale={locale} slug={slug} name={data.store.name} currency={data.store.currency} initial={data.config} owner={data.store.role === "owner"} />
  </CatalogFrame>;
}
