import "server-only";
import { request } from "node:http";

const maximum = 5 * 1024 * 1024;

export function rendererSocket() {
  const path = process.env.PAYMENT_RENDERER_SOCKET;
  return path && (path.startsWith("/run/dar-pdf/") ||
    (process.env.DAR_LOCAL_PDF === "true" && (path.startsWith("/tmp/dar-pdf-") || path.startsWith("\\\\.\\pipe\\dar-pdf-")))) ? path : null;
}

export function socketRenderer(path: string, input?: Buffer): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: path, method: input ? "POST" : "GET", path: input ? "/render" : "/health",
      signal: AbortSignal.timeout(input ? 11_000 : 2000), headers: input ? {
        "Content-Type": "application/pdf", "Content-Length": input.length,
      } : undefined }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximum) response.destroy(new Error("Renderer response too large."));
        else chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve(new Response(new Uint8Array(Buffer.concat(chunks, size)), {
        status: response.statusCode ?? 503,
        headers: { "content-type": String(response.headers["content-type"] ?? ""), "x-rendered-pages": String(response.headers["x-rendered-pages"] ?? "") },
      })));
    });
    req.once("error", reject);
    req.end(input);
  });
}
