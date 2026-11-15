import { catalogId } from "@/lib/catalog";
import { storeSlug } from "@/lib/validation";
import { mediaReply, streamCatalogImage } from "@/server/catalog/media-http";
import { getPublishedDesignAsset } from "@/server/themes/public";

export async function GET(_request: Request, context: RouteContext<"/api/store-design-media/[store]/[assetId]">) {
  const { store, assetId } = await context.params;
  if (!storeSlug.safeParse(store).success || !catalogId.safeParse(assetId).success) return mediaReply(404, "notFound");
  return streamCatalogImage(await getPublishedDesignAsset(store, assetId));
}
