import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { z } from "zod";
import { countries, currencies, signUpInput } from "../src/lib/validation";
import { intervals, planCodes } from "../src/lib/billing";
import { hashPassword } from "../src/server/auth/crypto";

const id = z.uuid();
const flags = z.object({ id, active: z.boolean().default(true) });
const market = flags.extend({ country: z.enum(countries), currency: z.enum(currencies) });
const amount = z.number().int().min(1).max(1_000_000_000);
const label = z.string().trim().min(1).max(100);
const definitions = z.strictObject({
  policy: z.object({ trialDays: z.number().int().min(1).max(30), trialProducts: z.number().int().min(1).max(30),
    graceDays: z.number().int().min(0).max(30) }).optional(),
  plans: z.array(z.object({ code: z.enum(planCodes), version: z.number().int().positive(), name: label,
    maxProducts: z.number().int().min(1).max(10_000), storageMiB: z.number().int().min(6).max(1_000_000),
    analytics: z.enum(["basic", "enhanced"]), luxury: z.boolean(), premium: z.boolean() })).default([]),
  prices: z.array(market.extend({ plan: z.enum(planCodes), version: z.number().int().positive(),
    interval: z.enum(intervals), amount })).default([]),
  methods: z.array(market.extend({ label, instructions: z.string().trim().min(1).max(1600) })).default([]),
  setups: z.array(market.extend({ label, amount })).default([]),
  availability: z.object({ prices: z.array(flags).default([]), methods: z.array(flags).default([]),
    setups: z.array(flags).default([]) }).optional(),
});

async function operator() {
  loadEnvConfig(process.cwd());
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("Use the schema-owner connection in the operator process.");
  const [operation, argument, displayName] = process.argv.slice(2);
  if (!argument || !["configure", "provision-account", "verify-email"].includes(operation)) {
    throw new Error("Usage: configure <file> | provision-account <email> <name> (password on stdin) | verify-email <email>. Assign reviewer roles in Platform administration.");
  }
  let account: { email: string; name: string; passwordHash: string } | undefined;
  if (operation === "provision-account") {
    if (process.stdin.isTTY) throw new Error("Pipe the password from a hidden prompt or a secret manager.");
    let password = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      password += chunk;
      if (password.length > 512) throw new Error("Invalid account input.");
    }
    const input = signUpInput.safeParse({ email: argument, name: displayName, password: password.replace(/\r?\n$/, "") });
    if (!input.success) throw new Error("Invalid account input.");
    account = { email: input.data.email, name: input.data.name, passwordHash: await hashPassword(input.data.password) };
  }
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5_000, max: 1 });
  try {
    const client = await pool.connect();
    try {
      const { rows: [role] } = await client.query("select current_user = pg_get_userbyid(relowner) as owner from pg_class where oid = 'public.billing_admins'::regclass");
      if (!role?.owner) throw new Error("The billing operator must use the schema-owner role.");
      await client.query("begin");
      if (operation === "configure") {
        const file = definitions.parse(JSON.parse((await readFile(argument, "utf8")).replace(/^\uFEFF/, "")));
        if (file.policy) await client.query("update public.billing_config set trial_days=$1, trial_products=$2, grace_days=$3",
          [file.policy.trialDays, file.policy.trialProducts, file.policy.graceDays]);
        for (const item of file.plans) await client.query(`insert into public.billing_plans(code,version,name,max_products,storage_mib,analytics,luxury,premium)
          values ($1,$2,$3,$4,$5,$6,$7,$8)`, [item.code, item.version, item.name, item.maxProducts, item.storageMiB, item.analytics, item.luxury, item.premium]);
        const tables = [["billing_prices", file.availability?.prices], ["billing_methods", file.availability?.methods],
          ["billing_setup_packages", file.availability?.setups]] as const;
        // Apply availability first so a price can be replaced atomically.
        for (const [table, records] of tables) for (const item of records ?? []) {
          if (!(await client.query(`update public.${table} set active=$1 where id=$2`, [item.active, item.id])).rowCount) throw new Error("Unknown availability record.");
        }
        for (const item of file.prices) {
          const result = await client.query(`insert into public.billing_prices(id,plan_id,country,currency,interval,amount,active)
            select $1,id,$2,$3,$4,$5,$6 from public.billing_plans where code=$7 and version=$8`,
            [item.id, item.country, item.currency, item.interval, item.amount, item.active, item.plan, item.version]);
          if (!result.rowCount) throw new Error("Unknown plan version.");
        }
        for (const item of file.methods) await client.query("insert into public.billing_methods values ($1,$2,$3,$4,$5,$6)",
          [item.id, item.country, item.currency, item.label, item.instructions, item.active]);
        for (const item of file.setups) await client.query("insert into public.billing_setup_packages values ($1,$2,$3,$4,$5,$6)",
          [item.id, item.country, item.currency, item.label, item.amount, item.active]);
        await client.query("select public.platform_log(null,null,'operator_billing_configuration')");
      } else if (account) {
        await client.query("insert into public.users(name,email,password_hash) values ($1,$2,$3)", [account.name, account.email, account.passwordHash]);
      } else {
        const email = z.email().parse(argument.trim().toLowerCase());
        const { rows: [user] } = await client.query("select id,email from public.users where email=$1", [email]);
        if (!user) throw new Error("Account does not exist.");
        await client.query("insert into public.billing_verified_accounts(user_id,email) values ($1,$2) on conflict do nothing", [user.id, user.email]);
        await client.query("select public.platform_log(null,$1,'operator_email_verified')", [user.id]);
      }
      await client.query("commit");
      console.log("Billing operator transaction completed.");
    } catch (error) {
      await client.query("rollback");
      if (error instanceof z.ZodError) throw new Error("Invalid billing operator input.");
      if (error instanceof Error && "code" in error) throw new Error(`Billing operator database rejected the transaction (${error.code}).`);
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

operator().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Billing operator failed.");
  process.exitCode = 1;
});
