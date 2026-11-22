import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());
const url = process.env.MIGRATION_DATABASE_URL;

export default defineConfig({
  schema: ["./src/server/db/schema.ts", "./src/server/db/catalog-schema.ts", "./src/server/db/theme-schema.ts", "./src/server/db/order-schema.ts", "./src/server/db/billing-schema.ts", "./src/server/db/platform-schema.ts", "./src/server/db/ai-schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  ...(url ? { dbCredentials: { url } } : {}),
});


