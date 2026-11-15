import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { cartInput, channelInput } from "@/lib/checkout";
import { storeSlug } from "@/lib/validation";
import { digest } from "@/server/auth/crypto";
import { consumeLimit } from "@/server/auth/repository";
import { trustedClientIp } from "@/server/auth/session";
import { mediaReply, validMediaOrigin } from "@/server/catalog/media-http";
import { beginOrder, openOrderContact, reviewCart } from "@/server/orders/public";

const locale = z.enum(["ar", "en"]);
const id = z.uuid();
const input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("review"), items: cartInput, locale }),
  z.strictObject({ action: z.literal("begin"), items: cartInput, locale, channel: channelInput, version: z.string().regex(/^[a-f0-9]{64}$/), id }),
  z.strictObject({ action: z.literal("open"), id, reference: z.string().regex(/^DM-[A-F0-9]{20}$/) }),
]);

async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body || request.headers.get("content-type")?.split(";")[0] !== "application/json") return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      bytes += value.byteLength;
      if (bytes > 65_536) { void reader.cancel().catch(() => {}); return null; }
      text += decoder.decode(value, { stream: true });
    }
  } catch { return null; }
  finally { reader.releaseLock(); }
}

const origin = process.env.APP_ORIGIN;
const secure = process.env.NODE_ENV === "production" && (!origin || origin.startsWith("https://") || origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"));
const cookieName = secure ? "__Host-dar_visitor" : "dar_visitor";
const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

export async function POST(request: Request, route: RouteContext<"/api/checkout/[store]">) {
  if (!validMediaOrigin(request)) return mediaReply(403, "forbidden");
  const { store } = await route.params;
  if (!storeSlug.safeParse(store).success) return mediaReply(404, "notFound");
  const parsed = input.safeParse(await boundedJson(request));
  if (!parsed.success) return mediaReply(400, "invalid");
  const payload = parsed.data;
  try {
    const jar = await cookies();
    let visitor = jar.get(cookieName)?.value;
    const known = visitor && /^[a-f0-9]{64}$/.test(visitor);
    if (!known && payload.action !== "review") return mediaReply(409, "stale");
    const ip = await trustedClientIp();
    const group = payload.action === "review" ? "review" : "write";
    if ((known && !await consumeLimit(`orders:${group}:visitor:${store}:${visitor}`, group === "review" ? 100 : 20))
      || (ip && !await consumeLimit(`orders:${group}:ip:${store}:${ip}`, group === "review" ? 120 : 30))
      || !await consumeLimit(`orders:${group}:store:${store}`, group === "review" ? 1800 : 300)) return mediaReply(429, "rateLimit");
    if (payload.action === "review") {
      const quote = await reviewCart(store, payload.items, payload.locale);
      if (!quote) return mediaReply(404, "notFound");
      if (!known) {
        visitor = randomBytes(32).toString("hex");
        jar.set(cookieName, visitor, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 7 * 86400 });
      }
      return response(quote);
    }
    const key = digest(`${visitor}:${payload.id}`);
    if (payload.action === "open") {
      const result = await openOrderContact(store, key, payload.reference);
      if (!result) return mediaReply(409, "disabled");
      return "stale" in result ? mediaReply(409, "stale") : response(result);
    }
    const result = await beginOrder({ ...payload, key, slug: store });
    return "error" in result ? response({ code: result.error, quote: result.quote }, result.error === "notFound" ? 404 : 409) : response(result);
  } catch {
    console.error("Checkout operation failed.");
    return mediaReply(503, "failed");
  }
}
