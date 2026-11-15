import "server-only";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { registrationAvailable } from "@/lib/billing";
import { ImageInputError, readCatalogImage } from "@/server/catalog/image-content";
import { rendererSocket, socketRenderer } from "./pdf-socket";

const cap = 5 * 1024 * 1024;
let activeDocuments = 0;

async function bytes(request: Request | Response) {
  if (Number(request.headers.get("content-length")) > cap) throw new ImageInputError(413);
  if (!request.body) throw new ImageInputError(415);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > cap) {
        void reader.cancel().catch(() => {});
        throw new ImageInputError(413);
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

export class ProofProcessorBusy extends Error {}

function rendererConfig() {
  try {
    const url = new URL(process.env.PAYMENT_RENDERER_URL ?? "");
    const key = process.env.PAYMENT_RENDERER_KEY;
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && key ? { url, key } : null;
  } catch { return null; }
}

export function proofRendererReady() {
  return Boolean(rendererSocket() || rendererConfig() || registrationAvailable(process.env.APP_ORIGIN, process.env.DAR_LOCAL_PDF));
}

export async function proofRendererAvailable() {
  const socket = rendererSocket();
  return socket ? (await socketRenderer(socket).catch(() => null))?.ok === true : proofRendererReady();
}

async function checkedPreview(response: Response) {
  if (response.status === 503) {
    await response.body?.cancel();
    throw new ProofProcessorBusy();
  }
  if (!response.ok || response.headers.get("content-type") !== "image/webp" || !/^[1-3]$/.test(response.headers.get("x-rendered-pages") ?? "")) {
    await response.body?.cancel();
    throw new ImageInputError(415);
  }
  const output = await bytes(response);
  try {
    const image = sharp(output, { limitInputPixels: 8_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== "webp" || (metadata.pages ?? 1) !== 1) throw new ImageInputError(415);
    return await image.webp({ quality: 92 }).toBuffer();
  } catch { throw new ImageInputError(415); }
}

async function renderPdf(input: Buffer) {
  if (activeDocuments >= 2) throw new ProofProcessorBusy();
  if (!/^%PDF-[12]\.\d/.test(input.subarray(0, 8).toString("ascii")) ||
    !/%%EOF[\t\n\f\r ]*$/.test(input.subarray(-1024).toString("latin1"))) throw new ImageInputError(415);
  activeDocuments++;
  try {
    const socket = rendererSocket();
    if (socket) {
      const result = await socketRenderer(socket, input).catch(() => { throw new ProofProcessorBusy(); });
      return await checkedPreview(result);
    }
    const renderer = rendererConfig();
    if (renderer) return await checkedPreview(await fetch(renderer.url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${renderer.key}`, "Content-Type": "application/pdf", Accept: "image/webp" }, body: new Uint8Array(input) }));
    if (!registrationAvailable(process.env.APP_ORIGIN, process.env.DAR_LOCAL_PDF)) throw new ProofProcessorBusy();
    return await new Promise<Buffer>((resolve, reject) => {
      const child = execFile(process.execPath, ["--max-old-space-size=192", join(process.cwd(), "scripts", "render-payment-proof.mjs")], {
        env: { NODE_ENV: "production", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) },
        encoding: "buffer", timeout: 10_000, maxBuffer: cap, windowsHide: true,
      }, (error, stdout) => error || !stdout.length ? reject(new ImageInputError(415)) : resolve(stdout));
      child.stdin?.on("error", () => {});
      child.stdin?.end(input);
    });
  } finally { activeDocuments--; }
}

export async function readPaymentProof(request: Request) {
  const type = request.headers.get("content-type");
  if (!type || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(type)) throw new ImageInputError(415);
  const input = await bytes(request);
  const content = type === "application/pdf"
    ? await renderPdf(input)
    : await readCatalogImage(new Request("http://localhost", {
      method: "POST", body: new Uint8Array(input), headers: { "Content-Type": type },
    }));
  if (content.length > cap) throw new ImageInputError(413);
  return { content, hash: createHash("sha256").update(content).digest("hex"), original: input, originalType: type };
}
