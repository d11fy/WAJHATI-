import { catalogId } from "@/lib/catalog";
import { readMerchantImage, removeImage, updateImage } from "@/server/catalog/media";
import { mediaReply, merchantMediaTarget, streamCatalogImage, validMediaOrigin } from "@/server/catalog/media-http";

type Context = RouteContext<"/api/catalog/[store]/[kind]/[target]/[imageId]">;

async function imageContext(context: Context) {
  const params = await context.params;
  if (!catalogId.safeParse(params.imageId).success) return null;
  const target = await merchantMediaTarget(params);
  return target ? { target, id: params.imageId } : null;
}

export async function GET(_request: Request, context: Context) {
  const image = await imageContext(context);
  return streamCatalogImage(image ? await readMerchantImage(image.target, image.id) : null);
}

export async function DELETE(request: Request, context: Context) {
  if (!validMediaOrigin(request)) return mediaReply(403, "forbidden");
  const image = await imageContext(context);
  if (!image || !await removeImage(image.target, image.id)) return mediaReply(404, "notFound");
  return new Response(null, { status: 204 });
}

export async function PATCH(request: Request, context: Context) {
  if (!validMediaOrigin(request)) return mediaReply(403, "forbidden");
  const operation = new URL(request.url).searchParams.get("operation");
  if (operation !== "primary" && operation !== "up" && operation !== "down") return mediaReply(400, "invalid");
  const image = await imageContext(context);
  if (!image || !await updateImage(image.target, image.id, operation)) return mediaReply(404, "notFound");
  return new Response(null, { status: 204 });
}
