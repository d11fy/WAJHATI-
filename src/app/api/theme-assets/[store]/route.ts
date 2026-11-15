import { z } from "zod";
import { designAssetKinds } from "@/lib/theme-config";
import { storeSlug } from "@/lib/validation";
import { consumeLimit } from "@/server/auth/repository";
import { readUser } from "@/server/auth/session";
import { ImageInputError, readCatalogImage } from "@/server/catalog/image-content";
import { mediaReply, validMediaOrigin } from "@/server/catalog/media-http";
import { catalogStorage } from "@/server/catalog/storage";
import { hasDatabaseConstraint } from "@/server/db/client";
import { getMemberStore } from "@/server/stores/repository";
import { finalizeDesignAsset, removeDesignAsset, reserveDesignAsset } from "@/server/themes/media";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/theme-assets/[store]">) {
  if (!validMediaOrigin(request)) return mediaReply(403, "forbidden");
  const { store } = await context.params;
  if (!storeSlug.safeParse(store).success) return mediaReply(404, "notFound");
  const kind = z.enum(designAssetKinds).safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return mediaReply(400, "invalid");
  const user = await readUser();
  if (!user || !await getMemberStore(user.id, store)) return mediaReply(404, "notFound");
  if (!await consumeLimit(`theme:upload:${user.id}`, 30)) return mediaReply(429, "rateLimit");
  let id: string | undefined;
  try {
    const content = await readCatalogImage(request);
    const reserved = await reserveDesignAsset(user.id, store, kind.data);
    if (!reserved) return mediaReply(404, "notFound");
    if ("error" in reserved) return mediaReply(409, reserved.error);
    id = reserved.id;
    await catalogStorage().put(reserved.objectKey, content);
    if (!await finalizeDesignAsset(user.id, store, id)) {
      await removeDesignAsset(user.id, store, id, true);
      return mediaReply(404, "notFound");
    }
    return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (id) await removeDesignAsset(user.id, store, id, true).catch(() => {});
    if (error instanceof ImageInputError) return mediaReply(error.status, error.status === 413 ? "tooLarge" : "invalidImage");
    if (hasDatabaseConstraint(error, "23514", "billing_storage_limit")) return mediaReply(409, "limit");
    return mediaReply(503, "unavailable");
  }
}
