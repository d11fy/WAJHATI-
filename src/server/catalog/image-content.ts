import "server-only";
import sharp from "sharp";

export const maximumImageBytes = 6 * 1024 * 1024;
const types = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as const;
type ImageType = keyof typeof types;

export class ImageInputError extends Error {
  constructor(public status: 413 | 415) { super("Invalid image input."); }
}

function hasSignature(bytes: Buffer, type: ImageType) {
  if (type === "image/jpeg") return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

export async function readCatalogImage(request: Request) {
  const type = request.headers.get("content-type");
  if (!type || !Object.hasOwn(types, type) || !request.body) throw new ImageInputError(415);
  const declared = Number(request.headers.get("content-length"));
  if (declared > maximumImageBytes) throw new ImageInputError(413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumImageBytes) {
        void reader.cancel().catch(() => {});
        throw new ImageInputError(413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  const imageType = type as ImageType;
  if (!hasSignature(bytes, imageType)) throw new ImageInputError(415);
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== types[imageType] || (metadata.pages ?? 1) > 1) throw new ImageInputError(415);
    const output = await image.autoOrient().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).webp({ quality: 83 }).toBuffer();
    if (output.length > maximumImageBytes) throw new ImageInputError(415);
    return output;
  } catch {
    throw new ImageInputError(415);
  }
}
