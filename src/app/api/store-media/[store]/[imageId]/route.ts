import { streamCatalogImage } from "@/server/catalog/media-http";
import { getPublicImage } from "@/server/catalog/public";

export async function GET(_request: Request, context: RouteContext<"/api/store-media/[store]/[imageId]">) {
  const { store, imageId } = await context.params;
  return streamCatalogImage(await getPublicImage(store, imageId));
}
