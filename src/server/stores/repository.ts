import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { storeSlug, type StoreInput } from "@/lib/validation";
import { withActor, type Transaction } from "@/server/db/actor";
import { database, isUniqueViolation } from "@/server/db/client";
import { storeMemberships, stores } from "@/server/db/schema";

const privateFields = {
  id: stores.id, name: stores.name, slug: stores.slug, country: stores.country,
  currency: stores.currency, published: sql<boolean>`coalesce(${stores.published} <= now(), false)`, role: storeMemberships.role,
};

export function listMemberStores(userId: string) {
  return withActor(userId, (tx) => tx.select(privateFields).from(stores)
    .innerJoin(storeMemberships, eq(storeMemberships.storeId, stores.id))
    .where(eq(storeMemberships.userId, userId)).orderBy(desc(stores.createdAt), stores.id));
}

export async function getMemberStore(userId: string, slug: string) {
  if (!storeSlug.safeParse(slug).success) return null;
  return withActor(userId, (tx) => findMemberStore(tx, userId, slug));
}

async function findMemberStore(tx: Transaction, userId: string, slug: string) {
  const [store] = await tx.select(privateFields).from(stores)
    .innerJoin(storeMemberships, eq(storeMemberships.storeId, stores.id))
    .where(and(eq(storeMemberships.userId, userId), eq(stores.slug, slug))).limit(1);
  return store ?? null;
}

type MemberStore = NonNullable<Awaited<ReturnType<typeof findMemberStore>>>;

export async function withMerchantStore<T>(userId: string, slug: string, write: boolean, operation: (tx: Transaction, store: MemberStore) => Promise<T>) {
  if (!storeSlug.safeParse(slug).success) return null;
  return withActor(userId, async (tx) => {
    const store = await findMemberStore(tx, userId, slug);
    if (!store) return null;
    await tx.execute(sql`select set_config('dar.store_id', ${store.id}, true)`);
    if (write) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${store.id}, 1))`);
    return operation(tx, store);
  });
}

export async function createStore(userId: string, input: StoreInput) {
  try {
    await withActor(userId, (tx) => tx.execute(sql`
      select public.create_store(${input.name}, ${input.slug}, ${input.country}, ${input.currency})
    `));
    return true;
  } catch (error) {
    if (isUniqueViolation(error, "stores_slug_unique")) return false;
    throw error;
  }
}

type PublicStore = Pick<typeof stores.$inferSelect, "name" | "slug" | "country" | "currency">;

/** The name of a published store that is paused because its trial or subscription ended (migration 0029). Null for everything else. */
export async function getPausedStore(slug: string, tx?: Transaction) {
  if (!storeSlug.safeParse(slug).success) return null;
  const result = await (tx ?? await database()).execute<{ name: string }>(sql`
    select name from public.get_paused_store(${slug})
  `);
  return result.rows[0] ?? null;
}

export async function getPublicStore(slug: string, tx?: Transaction) {
  if (!storeSlug.safeParse(slug).success) return null;
  const result = await (tx ?? await database()).execute<PublicStore>(sql`
    select name, slug, country, currency from public.get_public_store(${slug})
  `);
  return result.rows[0] ?? null;
}
