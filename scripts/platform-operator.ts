import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { z } from "zod";
import { digest } from "../src/server/auth/crypto";

async function run() {
  loadEnvConfig(process.cwd());
  const url=process.env.MIGRATION_DATABASE_URL;
  const [operation,address]=process.argv.slice(2);
  if (!url || !["bootstrap-owner","issue-enrollment","offline-recovery"].includes(operation)) throw new Error("Use the schema owner and bootstrap-owner, issue-enrollment or offline-recovery.");
  const email=z.email().parse(address?.trim().toLowerCase());
  let token="";
  if (operation!=="bootstrap-owner") {
    if (process.stdin.isTTY) throw new Error("Supply a generated 43-character base64url key on stdin.");
    process.stdin.setEncoding("utf8");
    for await (const part of process.stdin) {
      token+=part;
      if (token.length>128) throw new Error("Invalid enrollment key.");
    }
    token=token.trim();
    if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error("Invalid enrollment key.");
  }
  const pool=new Pool({connectionString:url, max:1, connectionTimeoutMillis:5000});
  try {
    const db=await pool.connect();
    try {
      await db.query("begin");
      const {rows:[owner]}=await db.query("select current_user=pg_get_userbyid(relowner) allowed from pg_class where oid='public.platform_roles'::regclass");
      if (!owner?.allowed) throw new Error("The schema-owner login is required.");
      await db.query("select pg_advisory_xact_lock(781690423)");
      const {rows:[account]}=await db.query("select u.id from public.users u join public.billing_verified_accounts v on v.user_id=u.id and v.email=u.email where u.email=$1",[email]);
      if (!account) throw new Error("An independently verified account is required.");
      if (operation==="bootstrap-owner") {
        if ((await db.query("select 1 from public.platform_roles where role='owner'")).rowCount) throw new Error("A platform owner already exists.");
        await db.query("insert into public.platform_roles(user_id,role) values($1,'owner')",[account.id]);
        await db.query("delete from public.sessions where user_id=$1",[account.id]);
      } else {
        if (!(await db.query("select 1 from public.platform_roles where user_id=$1",[account.id])).rowCount) throw new Error("Assign the platform role first.");
        if (operation==="offline-recovery") {
          await db.query("delete from public.sessions where user_id=$1",[account.id]);
          await db.query("delete from public.platform_recovery where user_id=$1",[account.id]);
          await db.query("delete from public.platform_mfa where user_id=$1",[account.id]);
        }
        const issued=await db.query(`insert into public.platform_mfa(user_id,enrollment_hash,enrollment_expiry)
          values($1,$2,now()+interval '30 minutes') on conflict(user_id) do update set enrollment_hash=excluded.enrollment_hash,
          enrollment_expiry=excluded.enrollment_expiry, secret=null,enrollment_session=null,last_counter=-1,attempts=0
          where not platform_mfa.enabled`,[account.id,digest(token)]);
        if (!issued.rowCount) throw new Error("An authenticator is already active.");
      }
      await db.query("select public.platform_log(null,$1,$2)",[account.id,`operator_${operation.replaceAll("-","_")}`]);
      await db.query("commit");
      console.log("Platform operator transaction completed.");
    } catch (error) {
      await db.query("rollback");
      if (error instanceof Error && "code" in error) throw new Error("The platform operator database rejected the operation.");
      throw error;
    } finally { db.release(); }
  } finally { await pool.end(); }
}

run().catch((error:unknown)=>{
  console.error(error instanceof z.ZodError ? "Invalid operator input." : error instanceof Error ? error.message : "Platform operator failed.");
  process.exitCode=1;
});
