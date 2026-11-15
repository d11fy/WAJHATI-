import { catalogId } from "@/lib/catalog";
import { storeSlug } from "@/lib/validation";
import { readUser } from "@/server/auth/session";
import { mediaReply, streamCatalogImage, validMediaOrigin } from "@/server/catalog/media-http";
import { readDesignAsset, removeDesignAsset } from "@/server/themes/media";

type Context = RouteContext<"/api/theme-assets/[store]/[assetId]">;

async function target(context: Context) {
  const { store, assetId } = await context.params;
  if (!storeSlug.safeParse(store).success || !catalogId.safeParse(assetId).success) return null;
  const user = await readUser();
  return user ? { userId: user.id, store, assetId } : null;
}

export async function GET(_request: Request, context: Context) {
  const asset = await target(context);
  return streamCatalogImage(asset ? await readDesignAsset(asset.userId, asset.store, asset.assetId) : null);
}

export async function DELETE(request: Request, context: Context) {
  if (!validMediaOrigin(request)) return mediaReply(403, "forbidden");
  const asset = await target(context);
  const result = asset ? await removeDesignAsset(asset.userId, asset.store, asset.assetId) : null;
  if (!result) return mediaReply(404, "notFound");
  if ("error" in result) return mediaReply(409, result.error);
  return new Response(null, { status: 204 });
}
