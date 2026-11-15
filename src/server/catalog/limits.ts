import "server-only";

type CatalogLimits = { categories: number; imagesPerProduct: number; imagesPerCategory: number };
type CatalogLimitProvider = (storeId: string) => CatalogLimits | Promise<CatalogLimits>;

export const limitsForStore: CatalogLimitProvider = () => ({
  categories: 100, imagesPerProduct: 8, imagesPerCategory: 1,
});
