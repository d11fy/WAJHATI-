import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

function createDatabase(url: string, identity = false) {
  const pool = new Pool({ connectionString: url, max: identity ? 4 : 10, connectionTimeoutMillis: 5_000 });
  pool.on("error", () => console.error("An idle PostgreSQL connection failed."));
  const db = drizzle(pool);
  let roleCheck: Promise<void> | undefined;

  return {
    async get() {
      roleCheck ??= pool.query<{ restricted: boolean }>(`
        select current_user = session_user
          and pg_has_role(current_user, '${identity ? "storefront_identity" : "storefront_app"}', 'USAGE')
          and not pg_has_role(session_user, '${identity ? "storefront_app" : "storefront_identity"}', 'MEMBER')
          and not pg_has_role(session_user, 'storefront_media_worker', 'MEMBER')
          and not has_schema_privilege(session_user, 'public', 'CREATE')
          and not exists (
            select 1 from pg_roles as r
            where (r.rolsuper or r.rolbypassrls or r.rolcreaterole)
              and pg_has_role(session_user, r.oid, 'MEMBER')
          )
          and (
            select count(*) = 49 and bool_and(row_security_active(t.oid) and not pg_has_role(session_user, t.relowner, 'MEMBER'))
            from pg_class as t join pg_namespace as n on n.oid = t.relnamespace
            where n.nspname = 'public' and t.relkind='r' and (t.relname like 'platform_%' or t.relname in (
              'users', 'sessions', 'identity_tokens', 'identity_changes', 'ops_notifications',
              'stores', 'store_memberships', 'catalog_categories', 'catalog_products', 'catalog_product_categories',
              'catalog_product_options', 'catalog_images', 'catalog_media_gc', 'store_designs', 'store_design_assets',
              'order_settings', 'order_intents', 'order_intent_items', 'order_intent_events',
              'billing_admins', 'billing_audit', 'billing_config', 'billing_methods', 'billing_periods', 'billing_plans',
              'billing_prices', 'billing_proofs', 'billing_requests', 'billing_reviews', 'billing_setup_packages',
              'billing_setup_requests', 'billing_subscriptions', 'billing_trials', 'billing_verified_accounts'
            ))
          ) as restricted
      `).then(({ rows }) => {
        if (!rows[0]?.restricted) throw new Error(identity ? "Database access requires the restricted identity role." : "DATABASE_URL must use the restricted runtime role.");
      }).catch((error: unknown) => {
        roleCheck = undefined;
        throw error;
      });
      await roleCheck;
      return db;
    },
    close: () => pool.end(),
  };
}

/**
 * The mail delivery process's handle. It connects as a dedicated login in `storefront_mailer`, whose only abilities are
 * SECURITY DEFINER functions (the notification queue, its own job log, the public WhatsApp number and the enabled SMTP
 * secret). The check refuses any login that could do more, or could read the secret table or other tables directly.
 */
function createMailerDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5_000 });
  pool.on("error", () => console.error("An idle PostgreSQL connection failed."));
  const db = drizzle(pool);
  let roleCheck: Promise<void> | undefined;
  return {
    async get() {
      roleCheck ??= pool.query<{ restricted: boolean }>(`
        select current_user = session_user
          and pg_has_role(current_user, 'storefront_mailer', 'USAGE')
          and not pg_has_role(session_user, 'storefront_app', 'MEMBER')
          and not pg_has_role(session_user, 'storefront_identity', 'MEMBER')
          and not pg_has_role(session_user, 'storefront_media_worker', 'MEMBER')
          and not has_schema_privilege(session_user, 'public', 'CREATE')
          and not exists (
            select 1 from pg_roles as r
            where (r.rolsuper or r.rolbypassrls or r.rolcreaterole) and pg_has_role(session_user, r.oid, 'MEMBER')
          )
          and not has_table_privilege(session_user, 'public.platform_mail', 'SELECT')
          and not has_table_privilege(session_user, 'public.users', 'SELECT')
          and not has_table_privilege(session_user, 'public.ops_notifications', 'SELECT') as restricted
      `).then(({ rows }) => {
        if (!rows[0]?.restricted) throw new Error("MAIL_WORKER_DATABASE_URL must use the restricted mail delivery role.");
      }).catch((error: unknown) => {
        roleCheck = undefined;
        throw error;
      });
      await roleCheck;
      return db;
    },
    close: () => pool.end(),
  };
}

const runtime = globalThis as typeof globalThis & {
  darDatabase?: ReturnType<typeof createDatabase>; darIdentity?: ReturnType<typeof createDatabase>; darMailer?: ReturnType<typeof createMailerDatabase>;
};

export function database() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for database-backed routes.");
  runtime.darDatabase ??= createDatabase(url);
  return runtime.darDatabase.get();
}

export function identityDatabase() {
  const url = process.env.IDENTITY_DATABASE_URL;
  if (!url) throw new Error("IDENTITY_DATABASE_URL is required for identity operations.");
  runtime.darIdentity ??= createDatabase(url, true);
  return runtime.darIdentity.get();
}

export function mailerDatabase() {
  const url = process.env.MAIL_WORKER_DATABASE_URL;
  if (!url) throw new Error("MAIL_WORKER_DATABASE_URL is required for mail delivery.");
  runtime.darMailer ??= createMailerDatabase(url);
  return runtime.darMailer.get();
}

export async function closeDatabase() {
  const db = runtime.darDatabase;
  const identity = runtime.darIdentity;
  const mailer = runtime.darMailer;
  delete runtime.darDatabase;
  delete runtime.darIdentity;
  delete runtime.darMailer;
  await Promise.all([db?.close(), identity?.close(), mailer?.close()]);
}

export function hasDatabaseConstraint(error: unknown, code: string, constraint: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === code && "constraint" in error) return error.constraint === constraint;
  return "cause" in error && hasDatabaseConstraint(error.cause, code, constraint);
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return hasDatabaseConstraint(error, "23505", constraint);
}
