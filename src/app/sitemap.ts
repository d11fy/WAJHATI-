import type { MetadataRoute } from "next";
import { sitemapEntries } from "@/lib/seo";

// Marketing pages only. Storefronts are merchant-controlled and are discovered through their own links.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries();
}
