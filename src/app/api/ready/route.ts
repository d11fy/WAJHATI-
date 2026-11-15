import { sql } from "drizzle-orm";
import { database, identityDatabase } from "@/server/db/client";
import { mailProvider } from "@/server/auth/mail";
import { mfaConfigured } from "@/server/platform/repository";
import { proofKeyReady } from "@/server/billing/proof-archive";
import { proofRendererAvailable, proofRendererReady } from "@/server/billing/proof";
import { catalogStorage } from "@/server/catalog/storage";
import { reportOperationalError } from "@/server/ops/report";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = Boolean((await mailProvider())) && mfaConfigured() && proofKeyReady() && proofRendererReady();
  let ready = false;
  if (configured) {
    try {
      const [runtime, identity] = await Promise.all([database(), identityDatabase()]);
      const [, , storage, pdf] = await Promise.all([runtime.execute(sql`select 1`), identity.execute(sql`select 1`),
        catalogStorage().ready(), proofRendererAvailable()]);
      if (!pdf) void reportOperationalError("pdf_failed", "readiness");
      ready = storage && pdf;
    } catch { void reportOperationalError("database_failed", "readiness"); }
  }
  return Response.json({ status: ready ? "ready" : "unavailable" }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
