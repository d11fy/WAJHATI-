import { readSessionToken } from "@/server/auth/session";
import { downloadOriginal, downloadProof } from "@/server/billing/repository";
import { mediaReply } from "@/server/catalog/media-http";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: RouteContext<"/api/payment-review/[payment]/proof">) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return mediaReply(404, "denied");
  const { payment } = await params;
  try {
    const token = await readSessionToken();
    const original = new URL(request.url).searchParams.get("source") === "original";
    const source = original ? await downloadOriginal(token, payment) : null;
    const content = original ? source?.content : await downloadProof(token, payment);
    if (!content) return mediaReply(404, "denied");
    const suffix = source ? ({ "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string,string>)[source.type] : "webp";
    return new Response(new Uint8Array(content), { headers: {
      "Content-Type": original ? "application/octet-stream" : "image/webp",
      "Content-Disposition": `attachment; filename="payment-${original ? "original" : "proof"}.${suffix ?? "bin"}"`,
      "Content-Length": String(content.length), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    } });
  } catch { return mediaReply(503, "unavailable"); }
}
