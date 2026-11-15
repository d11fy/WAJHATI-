import "server-only";
import { catalogId, type MediaKind } from "@/lib/catalog";
import { storeSlug } from "@/lib/validation";
import { readUser } from "@/server/auth/session";
import type { MediaTarget } from "./media";
import { catalogStorage } from "./storage";

export function validMediaOrigin(request: Request) {
  const origin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : new URL(request.url).origin;
  return request.headers.get("origin") === origin;
}

export async function merchantMediaTarget(params: { store: string; kind: string; target: string }): Promise<MediaTarget | null> {
  if (!storeSlug.safeParse(params.store).success || !catalogId.safeParse(params.target).success) return null;
  if (params.kind !== "product" && params.kind !== "category") return null;
  const user = await readUser();
  return user ? { ...params, kind: params.kind as MediaKind, userId: user.id } : null;
}

export function mediaReply(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function streamCatalogImage(key: string | null) {
  if (!key) return mediaReply(404, "notFound");
  try {
    const object = await catalogStorage().get(key);
    if (!object) return mediaReply(404, "notFound");
    const headers = new Headers({ "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    if (object.size !== undefined) headers.set("Content-Length", String(object.size));
    return new Response(object.stream, { headers });
  } catch {
    return mediaReply(503, "unavailable");
  }
}
