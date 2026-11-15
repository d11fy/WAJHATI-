import "server-only";
import { sql } from "drizzle-orm";
import { database } from "./client";

export type Transaction = Parameters<Parameters<Awaited<ReturnType<typeof database>>["transaction"]>[0]>[0];

export async function withActor<T>(userId: string, operation: (tx: Transaction) => Promise<T>) {
  return (await database()).transaction(async (tx) => {
    // Scope is released by PostgreSQL on commit and rollback, including pooled connections.
    await tx.execute(sql`select set_config('dar.user_id', ${userId}, true)`);
    return operation(tx);
  });
}
