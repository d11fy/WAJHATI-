import { createServer, request } from "node:http";
import { execFile } from "node:child_process";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = process.env.PAYMENT_RENDERER_SOCKET;
if (!path) throw new Error("A private renderer socket is required.");
const limit = 5 * 1024 * 1024;
if (process.argv.includes("--health")) {
  const probe = request({ socketPath: path, path: "/health", timeout: 1800 }, (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  });
  probe.on("timeout", () => probe.destroy());
  probe.on("error", () => { process.exitCode = 1; });
  probe.end();
} else {
  if (process.platform !== "win32") {
    try {
      if (!lstatSync(path).isSocket()) throw new Error("Unsafe existing renderer path.");
      unlinkSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const renderer = fileURLToPath(new URL("../render-payment-proof.mjs", import.meta.url));
  let occupied = false;
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000, keepAliveTimeout: 1500, maxHeaderSize: 4096 }, async (req, res) => {
    const reply = (status) => res.writeHead(status, { Connection: "close", "Cache-Control": "no-store" }).end();
    if (req.method === "GET" && req.url === "/health") { reply(200); return; }
    if (req.method !== "POST" || req.url !== "/render" || req.headers["content-type"] !== "application/pdf") { reply(415); return; }
    if (Number(req.headers["content-length"]) > limit) { reply(413); return; }
    if (occupied) { reply(503); return; }
    occupied = true;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > limit) { reply(413); return; }
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks, size);
      if (!/^%PDF-[12]\.\d/.test(input.subarray(0, 8).toString("ascii")) ||
        !/%%EOF[\t\n\f\r ]*$/.test(input.subarray(-1024).toString("latin1"))) { reply(415); return; }
      await new Promise((done) => {
        const child = execFile(process.execPath, ["--max-old-space-size=160", renderer, "--page-count"], {
          env: { NODE_ENV: "production", DISABLE_SYSTEM_FONTS_LOAD: "1",
            ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) },
          encoding: "buffer", timeout: 9000, killSignal: "SIGKILL", maxBuffer: limit, windowsHide: true,
        }, (error, stdout, stderr) => {
          const pages = /^DAR_PAGES=([1-3])$/m.exec(stderr.toString())?.[1];
          if (res.destroyed) { done(undefined); return; }
          if (error || !pages || !stdout.length) reply(error?.killed ? 503 : 415);
          else res.writeHead(200, { "Content-Type": "image/webp", "Content-Length": stdout.length,
            "X-Rendered-Pages": pages, "Cache-Control": "no-store", Connection: "close" }).end(stdout);
          done(undefined);
        });
        res.once("close", () => { if (!res.writableFinished) child.kill("SIGKILL"); });
        child.stdin?.on("error", () => {});
        child.stdin?.end(input);
      });
    } catch { if (!res.destroyed) reply(415); }
    finally { occupied = false; }
  });
  server.maxConnections = 12;
  server.listen(path, () => { if (process.platform !== "win32") chmodSync(path, 0o660); });
  for (const signal of ["SIGTERM","SIGINT"]) process.once(signal, () => server.close());
}
