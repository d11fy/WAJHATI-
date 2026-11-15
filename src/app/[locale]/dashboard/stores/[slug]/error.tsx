"use client";

import CatalogErrorPanel from "@/components/catalog/error-panel";

export default function StoreDashboardError({ reset }: { reset: () => void }) {
  return <CatalogErrorPanel reset={reset} platform />;
}
