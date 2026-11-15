import assert from "node:assert/strict";
import { Pool } from "pg";

export async function markLegacy(pool, ...slugs) {
  await pool.query(`delete from public.ops_notifications
    where kind = 'trial_started' and "window" in (select id::text from public.stores where slug = any($1))`, [slugs]);
  await pool.query(`delete from public.billing_audit
    where event = 'trial_started' and store_id in (select id from public.stores where slug = any($1))`, [slugs]);
  await pool.query(`delete from public.billing_trials
    where store_id in (select id from public.stores where slug = any($1))`, [slugs]);
  const result = await pool.query(`insert into public.billing_subscriptions(store_id,legacy,observed_status,observed_at)
    select id,true,'active',now() from public.stores where slug = any($1)
    on conflict (store_id) do update set legacy = true, observed_status = 'active', observed_at = now()`, [slugs]);
  assert.equal(result.rowCount, slugs.length);
  await pool.query(`insert into public.platform_legacy(store_id,until)
    select id,now()+interval '90 days' from public.stores where slug=any($1) on conflict do nothing`, [slugs]);
}

export async function grantLegacyForBrowser(slug) {
  assert.ok(process.env.TEST_MIGRATION_DATABASE_URL);
  const pool = new Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL });
  try { await markLegacy(pool, slug); }
  finally { await pool.end(); }
}
