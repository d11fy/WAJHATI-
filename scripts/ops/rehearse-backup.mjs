import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
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
const mediaBucket = `dar-development-media-${identifier}`;
const emptyBackup = `dar-development-backup-${identifier}e`;
const restoreGood = `dar-development-restore-media-${identifier}a`;
const restoreBad = `dar-development-restore-media-${identifier}b`;
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
async function integrity(url, login, password) {
  // Read as the dedicated backup role (BYPASSRLS, read-only) so counts are true counts, not policy-filtered ones.
  const probe = new URL(url.href); probe.username = login; probe.password = password;
  const client = new pg.Client({ connectionString: probe.href });
  try {
    await client.connect();
    const tables = (await client.query(`select c.relname as name, c.relrowsecurity as rls from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') order by 1`)).rows;
    const rows = {};
    for (const table of tables) rows[table.name] = Number((await client.query(`select count(*) from public."${table.name.replaceAll('"', '""')}"`)).rows[0].count);
    const { rows: [shape] } = await client.query(`select
      (select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and c.relrowsecurity) as rls_tables,
      (select count(*)::int from pg_policies where schemaname = 'public') as policies,
      (select count(*)::int from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace) as foreign_keys,
      (select count(*)::int from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace and not convalidated) as unvalidated_foreign_keys,
      (select count(*)::int from pg_indexes where schemaname = 'public') as indexes,
      (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace) as functions,
      (select count(*)::int from drizzle.__drizzle_migrations) as migrations`);
    return { rows, ...shape };
  } finally { await client.end(); }
}
try {
  const {rows:[actual]} = await admin.query("show data_directory");
  assert.equal(await realpath(actual.data_directory),expectedDirectory);
  // Sweep test roles left behind by an earlier interrupted rehearsal (names are generated hex, local fixture cluster only).
  for (const { rolname } of (await admin.query("select rolname from pg_roles where rolname ~ '^dar_backup_test_[0-9a-f]{12}$'")).rows) {
    await admin.query(`revoke connect on database dar_local_verify_billing from ${rolname}`);
    await admin.query(`drop role ${rolname}`);
  }
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
  emulator=new S3rver({address:"127.0.0.1",port:0,directory:objects,silent:true,vhostBuckets:false,configureBuckets:[bucket,mediaBucket,emptyBackup,restoreGood,restoreBad].map((name)=>({name}))});
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
  // Phase 2: realistic data. Back up the verification database itself (real browser-journey data across
  // many tenants), restore it into a fresh isolated database, and compare every table and security object.
  const realistic = `dar_restore_${identifier}r`;
  await admin.query(`create database ${realistic} owner dar_owner`);
  generated.add(realistic);
  for (const name of ["dar_local_verify_billing", realistic]) await admin.query(`grant connect on database ${name} to ${role}`);
  const realSource = at(ownerUrl, "dar_local_verify_billing");
  const realSpool = join(directory, "spool-realistic");
  await mkdir(realSpool, { recursive: true, mode: 0o700 });
  const realUrl = new URL(realSource.href); realUrl.username = role; realUrl.password = fixturePassword;
  const realEnv = { ...env, BACKUP_DATABASE_URL: realUrl.href, BACKUP_DIR: realSpool, RESTORE_DATABASE_URL: at(ownerUrl, realistic).href, RESTORE_CONFIRM: realistic };
  const backupStart = performance.now();
  await run([cli, "backup"], realEnv);
  const backupSeconds = (performance.now() - backupStart) / 1000;
  const [realFile] = (await readdir(realSpool)).filter((name) => name.endsWith(".enc"));
  assert.ok(realFile);
  const bytes = (await stat(join(realSpool, realFile))).size;
  const restoreStart = performance.now();
  await run([cli, "restore", `postgres/${realFile}`], realEnv);
  const restoreSeconds = (performance.now() - restoreStart) / 1000;
  const [original, restored] = [await integrity(realSource, role, fixturePassword), await integrity(at(ownerUrl, realistic), role, fixturePassword)];
  const totalRows = Object.values(original.rows).reduce((sum, count) => sum + count, 0);
  assert.ok(totalRows > 1000, "the verification database should hold real journey data");
  assert.deepEqual(restored, original, "every table row count and security object must match after restore");
  assert.ok(restored.rls_tables > 10 && restored.policies > 10 && restored.functions > 10);
  console.log(JSON.stringify({ event: "restore_rehearsal_realistic", scope: "local verification database, not production",
    tables: Object.keys(restored.rows).length, rows: totalRows, rlsTables: restored.rls_tables, policies: restored.policies,
    foreignKeys: restored.foreign_keys, unvalidatedForeignKeys: restored.unvalidated_foreign_keys, indexes: restored.indexes, functions: restored.functions, migrations: restored.migrations,
    encryptedBytes: bytes, backupSeconds: Number(backupSeconds.toFixed(2)), restoreSeconds: Number(restoreSeconds.toFixed(2)) }));
  // Phase 3: completeness. Media objects, manifests, the configuration snapshot, and the freshness alert, against the
  // same emulator. Source objects are generated here; no real merchant media is touched.
  const endpoint = `http://127.0.0.1:${address.port}`;
  const store = new S3Client({ endpoint, region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" },
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
  const read = async (from, key) => { const out = await store.send(new GetObjectCommand({ Bucket: from, Key: key })); const parts = []; for await (const part of out.Body) parts.push(part); return Buffer.concat(parts); };
  const put = (to, key, data) => store.send(new PutObjectCommand({ Bucket: to, Key: key, Body: data }));
  const list = async (from, prefix) => (await store.send(new ListObjectsV2Command({ Bucket: from, Prefix: prefix }))).Contents ?? [];
  const sha = (data) => createHash("sha256").update(data).digest("hex");
  const sources = new Map();
  for (let index = 0; index < 30; index++) {
    const key = `${randomUUID()}/${index % 2 ? "theme" : "catalog"}/${randomUUID()}.webp`;
    const data = index < 5 ? await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: index * 40, g: 90, b: 200 } } }).webp().toBuffer()
      : randomBytes(1000 + index * 7000);
    sources.set(key, data);
    await put(mediaBucket, key, data);
  }
  await put(mediaBucket, "ops/readiness", Buffer.from("not media"));
  const mediaEnv = { ...env, BACKUP_SOURCE_BUCKET: mediaBucket, BACKUP_SOURCE_S3_ENDPOINT: endpoint, BACKUP_SOURCE_S3_FORCE_PATH_STYLE: "true",
    BACKUP_SOURCE_AWS_ACCESS_KEY_ID: "S3RVER", BACKUP_SOURCE_AWS_SECRET_ACCESS_KEY: "S3RVER", BACKUP_DATABASE_URL: realUrl.href, BACKUP_DIR: realSpool,
    RESTORE_MEDIA_S3_ENDPOINT: endpoint, RESTORE_MEDIA_S3_FORCE_PATH_STYLE: "true", RESTORE_MEDIA_AWS_ACCESS_KEY_ID: "S3RVER", RESTORE_MEDIA_AWS_SECRET_ACCESS_KEY: "S3RVER" };
  const latestManifest = async (kind, from = bucket) => {
    const manifests = (await list(from, `meta/${kind}-`)).map((object) => object.Key).sort();
    assert.ok(manifests.length > 0, `a ${kind} manifest exists`);
    return JSON.parse((await read(from, manifests.at(-1))).toString());
  };

  await run([cli, "media"], mediaEnv);
  const encryptedObjects = await list(bucket, "media/");
  assert.equal(encryptedObjects.length, 30, "every media object, and only media objects, is backed up");
  assert.ok(!encryptedObjects.some((object) => object.Key.includes("ops/readiness")));
  const [sampleKey, sampleData] = [...sources].find(([, data]) => data.includes(Buffer.from("WEBP")));
  const sealed = await read(bucket, `media/${sampleKey}.enc`);
  assert.ok(!sealed.includes(Buffer.from("WEBP")) && !sealed.includes(sampleData.subarray(0, 24)), "media is encrypted at rest in the backup bucket");
  let media = await latestManifest("media");
  assert.deepEqual([media.objects, media.copied, media.skipped], [30, 30, 0]);
  await delay(1100);
  await run([cli, "media"], mediaEnv);
  media = await latestManifest("media");
  assert.deepEqual([media.objects, media.copied, media.skipped], [30, 0, 30], "a second run copies nothing");
  const changedKey = [...sources.keys()][7];
  const changed = randomBytes(5000);
  sources.set(changedKey, changed);
  await put(mediaBucket, changedKey, changed);
  await delay(1100);
  await run([cli, "media"], mediaEnv);
  media = await latestManifest("media");
  assert.deepEqual([media.objects, media.copied, media.skipped], [30, 1, 29], "only the changed object is copied");

  // Database manifest written by the phase 2 backup.
  const postgres = await latestManifest("postgres");
  assert.equal(postgres.sha256, createHash("sha256").update(await readFile(join(realSpool, realFile))).digest("hex"));
  assert.equal(postgres.migrations, restored.migrations);
  assert.equal(postgres.file, realFile);
  assert.ok(Array.isArray(postgres.instructions) && postgres.instructions.length >= 4);

  // Configuration snapshot: file hashes and variable NAMES, never values.
  await run([cli, "config"], mediaEnv);
  const configText = (await read(bucket, (await list(bucket, "meta/config-")).map((object) => object.Key).sort().at(-1))).toString();
  const config = JSON.parse(configText);
  assert.equal(config.files["compose.yaml"], createHash("sha256").update(await readFile("compose.yaml")).digest("hex"));
  assert.ok(config.environmentVariableNames.includes("BACKUP_KEY") && config.environmentVariableNames.includes("BACKUP_SOURCE_BUCKET"));
  for (const secret of [env.BACKUP_KEY, fixturePassword, env.BACKUP_DATABASE_URL, realUrl.href]) assert.ok(!configText.includes(secret), "the configuration snapshot must not contain a secret value");
  assert.ok(config.migrations.count >= 28);

  // Media restore into an isolated, empty bucket, then every object must match the source byte for byte.
  const restoreEnv = (target) => ({ ...mediaEnv, RESTORE_MEDIA_BUCKET: target, RESTORE_MEDIA_CONFIRM: target });
  await run([cli, "media-restore"], restoreEnv(restoreGood));
  const restoredMedia = await list(restoreGood, "");
  assert.equal(restoredMedia.length, 30);
  for (const [key, data] of sources) assert.equal(sha(await read(restoreGood, key)), sha(data), `restored media matches for ${key}`);
  await run([cli, "media-restore"], restoreEnv(restoreGood), 1);   // not empty
  await run([cli, "media-restore"], { ...restoreEnv(restoreGood), RESTORE_MEDIA_CONFIRM: "wrong" }, 1);
  await run([cli, "media-restore"], restoreEnv(mediaBucket), 1);    // a live bucket is never a target
  // A tampered backup object is detected during restore.
  const victim = encryptedObjects[3].Key;
  const damaged = Buffer.from(await read(bucket, victim));
  damaged[damaged.length - 1] ^= 1;
  await put(bucket, victim, damaged);
  await run([cli, "media-restore"], restoreEnv(restoreBad), 1);

  // Freshness: fresh backups pass, an aged threshold fails, and an empty backup bucket fails for the missing database manifest.
  await run([cli, "check"], { ...mediaEnv, BACKUP_MAX_AGE_HOURS: "24" });
  await delay(1500);
  await run([cli, "check"], { ...mediaEnv, BACKUP_MAX_AGE_HOURS: "0.0002" }, 1);
  await run([cli, "check"], { ...mediaEnv, BACKUP_BUCKET: emptyBackup, BACKUP_MAX_AGE_HOURS: "24" }, 1);
  store.destroy();
  console.log(JSON.stringify({ event: "backup_completeness_rehearsal_passed", mediaObjects: 30, encryptedAtRest: true, incremental: true, restoreVerified: true,
    tamperRejected: true, nonEmptyTargetRejected: true, configSnapshotSecretFree: true, staleAlertFires: true, missingBackupAlertFires: true }));
  console.log(JSON.stringify({event:"restore_rehearsal_passed",storage:"isolated_s3_emulator",
    tamperRejected:true,nonEmptyTargetRejected:true,artifact:join(spool,file)}));
} finally {
  await emulator?.close().catch(()=>{});
  for(const name of [target,source,`dar_restore_${identifier}r`]) if(generated.has(name)) await admin.query(`drop database ${name}`);
  if(generated.has(role)) {
    // The realistic phase grants this role CONNECT on the verification database; a role cannot be dropped while it holds a privilege.
    await admin.query(`revoke connect on database dar_local_verify_billing from ${role}`);
    await admin.query(`drop role ${role}`);
  }
  await admin.end();
}
