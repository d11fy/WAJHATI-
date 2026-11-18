import type { MetadataRoute } from "next";
import { robotsRules } from "@/lib/seo";

// Evaluated per request so the staging/production decision uses the runtime environment, not the build's.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsRules();
}
