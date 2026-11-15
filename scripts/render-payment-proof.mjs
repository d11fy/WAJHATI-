import { createCanvas } from "@napi-rs/canvas";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";

sharp.concurrency(1);

const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length;
  if (length > 5 * 1024 * 1024) throw new Error("PDF too large");
  chunks.push(chunk);
}

const resources = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const resourcePath = (name) => join(resources, name).replaceAll("\\", "/") + "/";
const job = getDocument({
  data: new Uint8Array(Buffer.concat(chunks, length)), isEvalSupported: false, stopAtErrors: true,
  enableXfa: false, maxImageSize: 8_000_000, canvasMaxAreaInBytes: 32_000_000,
  useSystemFonts: false, useWorkerFetch: false, verbosity: 0,
  standardFontDataUrl: resourcePath("standard_fonts"), cMapUrl: resourcePath("cmaps"), wasmUrl: resourcePath("wasm"),
});
try {
  const document = await job.promise;
  if (document.numPages < 1 || document.numPages > 3) throw new Error("Unexpected PDF page count");
  const rendered = [];
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index);
    const actual = page.getViewport({ scale: 1 });
    const maximum = Math.max(actual.width, actual.height);
    if (!Number.isFinite(maximum) || Math.min(actual.width, actual.height) < 1) throw new Error("Unexpected PDF dimensions");
    const viewport = page.getViewport({ scale: Math.min(3, 1500 / maximum) });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const canvas = createCanvas(width, height);
    await page.render({ canvas, viewport, annotationMode: 0 }).promise;
    rendered.push({ input: canvas.toBuffer("image/png"), width, height });
    page.cleanup();
  }
  let top = 0;
  const width = Math.max(...rendered.map((page) => page.width));
  const layers = rendered.map((page) => {
    const layer = { input: page.input, left: Math.floor((width - page.width) / 2), top };
    top += page.height;
    return layer;
  });
  const output = await sharp({ create: { width, height: top, channels: 3, background: "white" } })
    .composite(layers).webp({ quality: 90 }).toBuffer();
  if (process.argv.includes("--page-count")) process.stderr.write(`DAR_PAGES=${document.numPages}\n`);
  process.stdout.write(output);
} finally { await job.destroy(); }
