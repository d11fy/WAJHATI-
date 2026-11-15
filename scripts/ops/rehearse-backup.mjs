import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import pg from "pg";

function run(args, env, expected = 0) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath,args,{ env, stdio:"inherit", windowsHide:true });
    child.once("error",reject);
    child.once("exit",(code)=>code===expected?done(undefined):reject(new Error("Rehearsal command returned an unexpected status.")));
  });
}

const adminUrl = new URL(process.env.TEST_CLUSTER_ADMIN_URL ?? "");
const ownerUrl = new URL(process.env.TEST_MIGRATION_DATABASE_URL ?? "");
assert.equal(adminUrl.hostname,"127.0.0.1");
assert.equal(adminUrl.host,ownerUrl.host);
assert.equal(adminUrl.pathname,"/postgres");
assert.equal(ownerUrl.pathname,"/dar_local_verify_billing");
const expectedDirectory = await realpath(process.env.TEST_CLUSTER_DATA_DIR ?? "");
const admin = new pg.Client({ connectionString:adminUrl.href });
await admin.connect();
const identifier = randomUUID().replaceAll("-","").slice(0,12);
const source = `dar_backup_seed_${identifier}`;
const target = `dar_restore_${identifier}`;
const role = `dar_backup_test_${identifier}`;
const fixturePassword = randomBytes(24).toString("hex");
const directory = resolve(".dar-local","ops-rehearsals",identifier);
const objects = join(directory,"objects");
const spool = join(directory,"spool");
const bucket = `dar-development-backup-${identifier}`;
const generated = new Set();
let emulator;
function at(url,name) { const updated=new URL(url.href); updated.pathname="/"+name; return updated; }
async function fingerprint(url) {
  const client=new pg.Client({connectionString:url.href});
  try {
    await client.connect();
    return (await client.query(`select md5(jsonb_build_array(
      (select jsonb_agg(to_jsonb(s) order by id) from public.stores s),
      (select jsonb_agg(to_jsonb(m) order by store_id,user_id) from public.store_memberships m),
      (select jsonb_agg(to_jsonb(d) order by id) from drizzle.__drizzle_migrations d))::text) as digest`)).rows[0].digest;
  } finally { await client.end(); }
}
try {
  const {rows:[actual]} = await admin.query("show data_directory");
  assert.equal(await realpath(actual.data_directory),expectedDirectory);
  await mkdir(objects,{recursive:true,mode:0o700});
  await mkdir(spool,{recursive:true,mode:0o700});
  for(const name of [source,target]){
    await admin.query(`create database ${name} owner dar_owner`);
    generated.add(name);
  }
  await admin.query(`create role ${role} login nosuperuser nocreaterole bypassrls password '${fixturePassword}' in role pg_read_all_data`);
  generated.add(role);
  await admin.query(`alter role ${role} set default_transaction_read_only=on`);
  const sourceOwner = at(ownerUrl,source);
  await run(["node_modules/drizzle-kit/bin.cjs","migrate"],{...process.env,MIGRATION_DATABASE_URL:sourceOwner.href});
  const seed = new pg.Client({connectionString:sourceOwner.href});
  try {
    await seed.connect();
    await seed.query(`with account as (insert into public.users(name,email,password_hash)
      values('Backup fixture','backup-fixture@example.test','fixture-only') returning id),
      store as (insert into public.stores(name,slug,country,currency) values('Backup fixture','backup-fixture','JO','JOD') returning id)
      insert into public.store_memberships(store_id,user_id,role) select store.id,account.id,'owner' from store,account`);
  } finally { await seed.end(); }
  const before=await fingerprint(sourceOwner);
  const require=createRequire(process.env.TEST_S3RVER_PACKAGE);
  const S3rver=require("s3rver");
  emulator=new S3rver({address:"127.0.0.1",port:0,directory:objects,silent:true,vhostBuckets:false,configureBuckets:[{name:bucket}]});
  const address=await emulator.run();
  const backupUrl=at(ownerUrl,source);
  backupUrl.username=role; backupUrl.password=fixturePassword;
  const env={...process.env,DAR_ENV:"development",DAR_BACKUP_LOCAL_ONLY:"false",BACKUP_DATABASE_URL:backupUrl.href,
    BACKUP_DIR:spool,BACKUP_KEY_ID:"fixture_v1",BACKUP_KEY:randomBytes(32).toString("hex"),BACKUP_BUCKET:bucket,
    BACKUP_S3_ENDPOINT:`http://127.0.0.1:${address.port}`,BACKUP_S3_FORCE_PATH_STYLE:"true",
    BACKUP_AWS_ACCESS_KEY_ID:"S3RVER",BACKUP_AWS_SECRET_ACCESS_KEY:"S3RVER",DATABASE_URL:"",IDENTITY_DATABASE_URL:"",
    MIGRATION_DATABASE_URL:"",MEDIA_WORKER_DATABASE_URL:"",PLATFORM_MFA_KEY:"",PAYMENT_PROOF_KEYRING:"",
    DAR_ALERT_WEBHOOK:"",RESTORE_DATABASE_URL:at(ownerUrl,target).href,RESTORE_CONFIRM:target};
  const cli="scripts/ops/backup.mjs";
  await run([cli,"backup"],env);
  const [file]= (await readdir(spool)).filter((name)=>name.endsWith(".enc"));
  assert.ok(file);
  const encrypted=await readFile(join(spool,file));
  const broken=Buffer.from(encrypted); broken[broken.length-1]^=1;
  const bad=join(directory,"tampered.enc");
  await writeFile(bad,broken,{mode:0o600,flag:"wx"});
  await run([cli,"restore",bad],env,1);
  await run([cli,"restore",`postgres/${file}`],env);
  assert.equal(await fingerprint(at(ownerUrl,target)),before);
  await run([cli,"restore",`postgres/${file}`],env,1);
  assert.equal(await fingerprint(at(ownerUrl,target)),before);
  console.log(JSON.stringify({event:"restore_rehearsal_passed",storage:"isolated_s3_emulator",
    tamperRejected:true,nonEmptyTargetRejected:true,artifact:join(spool,file)}));
} finally {
  await emulator?.close().catch(()=>{});
  for(const name of [target,source]) if(generated.has(name)) await admin.query(`drop database ${name}`);
  if(generated.has(role)) await admin.query(`drop role ${role}`);
  await admin.end();
}
