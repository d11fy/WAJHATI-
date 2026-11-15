import { consumeLimit } from "@/server/auth/repository";
import { ImageInputError, readCatalogImage } from "@/server/catalog/image-content";
import { checkImageTarget, finalizeImage, removeImage, reserveImage } from "@/server/catalog/media";
import { mediaReply, merchantMediaTarget, validMediaOrigin } from "@/server/catalog/media-http";
import { catalogStorage } from "@/server/catalog/storage";
import { hasDatabaseConstraint } from "@/server/db/client";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/catalog/[store]/[kind]/[target]">) {
  if (!validMediaOrigin(request)) return mediaReply(403, "forbidden");
  const target = await merchantMediaTarget(await context.params);
  if (!target || !await checkImageTarget(target)) return mediaReply(404, "notFound");
  if (!await consumeLimit(`catalog:upload:${target.userId}`, 30)) return mediaReply(429, "rateLimit");
  let id: string | undefined;
  try {
    const storage = catalogStorage();
    const content = await readCatalogImage(request);
    const reserved = await reserveImage(target);
    if (!reserved) return mediaReply(404, "notFound");
    if ("error" in reserved) return mediaReply(409, reserved.error);
    id = reserved.id;
    await storage.put(reserved.objectKey, content);
    if (!await finalizeImage(target, reserved.id)) {
      await removeImage(target, reserved.id, true);
      return mediaReply(404, "notFound");
    }
    return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (id) await removeImage(target, id, true).catch(() => {}); // The worker also reaps stale reservations.
    if (error instanceof ImageInputError) return mediaReply(error.status, error.status === 413 ? "tooLarge" : "invalidImage");
    if (hasDatabaseConstraint(error, "23514", "billing_storage_limit")) return mediaReply(409, "limit");
    return mediaReply(503, "unavailable");
  }
}
