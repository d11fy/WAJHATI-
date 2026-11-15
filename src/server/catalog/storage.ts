import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { reportOperationalError } from "@/server/ops/report";

export interface CatalogStorage {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size?: number } | null>;
  remove(key: string): Promise<void>;
  ready(): Promise<boolean>;
}

let storage: CatalogStorage | undefined;

export function catalogStorage(): CatalogStorage {
  if (storage) return storage;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is required for catalog media.");
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined, region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true", maxAttempts: 2,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  const timeout = () => ({ abortSignal: AbortSignal.timeout(20_000) });
  storage = {
    async put(key, body) {
      try { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "image/webp" }), timeout()); }
      catch (error) { void reportOperationalError("storage_failed", "put"); throw error; }
    },
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), timeout());
        return result.Body ? { stream: result.Body.transformToWebStream(), size: result.ContentLength } : null;
      } catch (error) {
        if (error instanceof Error && (error.name === "NoSuchKey" || error.name === "NotFound")) return null;
        void reportOperationalError("storage_failed", "get");
        throw error;
      }
    },
    async remove(key) {
      try { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), timeout()); }
      catch (error) { void reportOperationalError("storage_failed", "delete"); throw error; }
    },
    async ready() {
      const key = process.env.S3_READY_KEY;
      if (!key) return process.env.DAR_ENV !== "production" && process.env.DAR_ENV !== "staging";
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(1800) });
        return true;
      } catch { void reportOperationalError("storage_failed", "readiness"); return false; }
    },
  };
  return storage;
}
