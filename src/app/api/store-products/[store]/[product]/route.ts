import { storeSlug } from "@/lib/validation";
import { getPublicProduct } from "@/server/catalog/public";

type Context = RouteContext<"/api/store-products/[store]/[product]">;

/** Public, read-only: the option groups and availability of one published product, so a product card can offer "add to cart" without opening the page. */
export async function GET(_request: Request, context: Context) {
  const { store, product } = await context.params;
  if (!storeSlug.safeParse(store).success || !storeSlug.safeParse(product).success) return Response.json({ error: "notFound" }, { status: 404 });
  const item = await getPublicProduct(store, product);
  if (!item) return Response.json({ error: "notFound" }, { status: 404 });
  return Response.json({ available: item.available, options: item.options }, { headers: { "Cache-Control": "public, max-age=30" } });
}
