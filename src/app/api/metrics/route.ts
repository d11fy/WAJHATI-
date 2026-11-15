import { createHash, timingSafeEqual } from "node:crypto";
import { operationalMetrics } from "@/server/ops/report";

export const dynamic = "force-dynamic";
const hash = (value: string) => createHash("sha256").update(value).digest();

export function GET(request: Request) {
  const key = process.env.OPS_METRICS_TOKEN;
  const headers = { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" };
  if (!key || !timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash(`Bearer ${key}`))) {
    return new Response("Not found\n", { status: 404, headers });
  }
  return new Response(operationalMetrics(), { headers });
}
