import type { Metadata } from "next";
import type { ReactNode } from "react";
import { designAssetPath } from "@/lib/theme-config";
import { getPublishedDesign } from "@/server/themes/public";

export async function generateMetadata({ params }: LayoutProps<"/[locale]/s/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const design = await getPublishedDesign(slug);
  return design.assets.icon ? { icons: { icon: { url: designAssetPath(slug, design.assets.icon), type: "image/webp" } } } : {};
}

export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return children;
}
