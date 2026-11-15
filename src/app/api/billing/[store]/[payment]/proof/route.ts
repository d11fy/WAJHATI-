import { transferReference } from "@/lib/billing";
import { consumeLimit } from "@/server/auth/repository";
import { readUser } from "@/server/auth/session";
import { ImageInputError } from "@/server/catalog/image-content";
import { mediaReply, validMediaOrigin } from "@/server/catalog/media-http";
import { ProofProcessorBusy, readPaymentProof } from "@/server/billing/proof";
import { sealProof } from "@/server/billing/proof-archive";
import { canUploadProof, submitProof } from "@/server/billing/repository";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: RouteContext<"/api/billing/[store]/[payment]/proof">) {
  if (!validMediaOrigin(request)) return mediaReply(403, "denied");
  const { store, payment } = await params;
  try {
    const user = await readUser();
    if (!user || !await canUploadProof(user.id, store, payment)) return mediaReply(404, "denied");
    if (!await consumeLimit(`billing:proof:${user.id}`, 12)) return mediaReply(429, "rateLimit");
    let reference: string;
    try { reference = decodeURIComponent(request.headers.get("x-payment-reference") ?? ""); }
    catch { return mediaReply(400, "invalid"); }
    const parsed = transferReference.safeParse(reference);
    if (!parsed.success) return mediaReply(400, "invalid");
    const { content, hash, original, originalType } = await readPaymentProof(request);
    const result = await submitProof(user.id, store, payment, parsed.data, content, hash, sealProof(payment, original, originalType));
    if (result === "ok") return mediaReply(200, "ok");
    return mediaReply(result === "denied" ? 404 : 409, result ?? "closed");
  } catch (error) {
    if (error instanceof ImageInputError) return mediaReply(error.status, error.status === 413 ? "tooLarge" : "invalidProof");
    if (error instanceof ProofProcessorBusy) return mediaReply(503, "unavailable");
    return mediaReply(503, "unavailable");
  }
}
