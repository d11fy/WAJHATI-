import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { validateEnv } from "./validate-env.mjs";

const headerLimit = 512;
const version = "DAR-PG-AES256-GCM-1";
const prefix = "dar-backup-";
const keyId = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const keyHex = /^[a-f0-9]{64}$/;
const filename = /^dar-backup-\d{8}T\d{6}Z-[0-9a-f]{8}\.enc$/;

function database(value) {
  const url = new URL(value ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password ||
    !/^\/[a-z][a-z0-9_]{2,62}$/.test(url.pathname)) throw new Error("Invalid database configuration.");
  const db = url.pathname.slice(1);
  return { db, url, env: {
    ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432", PGDATABASE: db,
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
    PGCONNECT_TIMEOUT: "5", BACKUP_DATABASE_URL: "", RESTORE_DATABASE_URL: "", BACKUP_KEY: "", BACKUP_KEYRING: "",
    BACKUP_AWS_ACCESS_KEY_ID: "", BACKUP_AWS_SECRET_ACCESS_KEY: "",
  } };
}

function command(name, db, args, stdio) {
  const bin = process.env.DAR_PG_BIN ? join(process.env.DAR_PG_BIN, name + (process.platform === "win32" ? ".exe" : "")) : name;
  return spawn(bin, args, { env: db.env, stdio, windowsHide: true });
}

function done(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(undefined) : reject(new Error("PostgreSQL utility failed.")));
  });
}

function encryptionKey(id) {
  if (!keyId.test(id ?? "")) throw new Error("Invalid backup key version.");
  const ring = process.env.BACKUP_KEYRING ? JSON.parse(process.env.BACKUP_KEYRING) : {};
  const value = id === process.env.BACKUP_KEY_ID ? process.env.BACKUP_KEY : ring[id];
  if (!keyHex.test(value ?? "")) throw new Error("Backup decryption key unavailable.");
  return Buffer.from(value, "hex");
}

function client() {
  return new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined, region: process.env.BACKUP_REGION ?? "us-east-1",
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY ?? "" },
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function localOnly() {
  return process.env.DAR_ENV === "development" && process.env.DAR_BACKUP_LOCAL_ONLY === "true";
}

function spool() {
  if (!process.env.BACKUP_DIR) throw new Error("A private backup directory is required.");
  return resolve(process.env.BACKUP_DIR);
}

async function cleanScratch(path) {
  for (const file of await readdir(path)) await unlink(join(path,file));
  await rmdir(path);
}

async function prune(directory) {
  const keepMs = 7 * 86400000;
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".uploaded") || !filename.test(name.slice(0, -9))) continue;
    const marker = join(directory, name);
    if (Date.now() - (await stat(marker)).mtimeMs < keepMs) continue;
    await unlink(join(directory, name.slice(0, -9))).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await unlink(marker);
  }
}

async function upload(file, name) {
  const bucket = process.env.BACKUP_BUCKET;
  const size = (await stat(file)).size;
  if (size > 5_000_000_000) throw new Error("Single-object backup limit exceeded.");
  const storage = client();
  const key = `postgres/${name}`;
  try {
    await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(file), ContentLength: size,
      ContentType: "application/octet-stream" }), { abortSignal: AbortSignal.timeout(180_000) });
    const object = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10_000) });
    if (object.ContentLength !== size) throw new Error("Off-server backup size did not match.");
  } finally { storage.destroy(); }
  await writeFile(file + ".uploaded", "confirmed\n", { flag: "wx", mode: 0o600 });
}

async function backup() {
  if (!localOnly() && validateEnv(process.env, "backup").length) throw new Error("Invalid backup environment.");
  const source = database(process.env.BACKUP_DATABASE_URL);
  const directory = spool();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(directory, ".write-"));
  const lock = new pg.Client({ connectionString: source.url.href, connectionTimeoutMillis: 5000 });
  try {
    await lock.connect();
    const { rows: [role] } = await lock.query(`select not rolsuper and rolbypassrls and not rolcreaterole
      and pg_has_role(current_user,'pg_read_all_data','MEMBER') and not pg_has_role(current_user,'storefront_app','MEMBER')
      and not pg_has_role(current_user,'storefront_identity','MEMBER') and not pg_has_role(current_user,'storefront_media_worker','MEMBER')
      and not pg_has_role(current_user,'storefront_mailer','MEMBER') as allowed
      from pg_roles where rolname=current_user`);
    if (!role?.allowed) throw new Error("Dedicated read-only backup login required.");
    if (!(await lock.query("select pg_try_advisory_lock(1627986172) as ok")).rows[0].ok) throw new Error("A backup is already running.");
    const { rows: [facts] } = await lock.query(`select (select count(*)::int from drizzle.__drizzle_migrations) as migrations,
      (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')) as tables, current_setting('server_version') as server`);
    const now = new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
    const name = `${prefix}${now}-${randomUUID().slice(0,8)}.enc`;
    const nonce = randomBytes(12);
    const id = process.env.BACKUP_KEY_ID;
    const header = Buffer.from(JSON.stringify({ version, id, nonce: nonce.toString("hex") }) + "\n");
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(id), nonce);
    cipher.setAAD(header);
    const temporary = join(work, name);
    await writeFile(temporary, header, { flag: "wx", mode: 0o600 });
    const dump = command("pg_dump", source, ["--no-password","--format=custom","--lock-wait-timeout=10s"], ["ignore","pipe","ignore"]);
    const watchdog = setTimeout(() => dump.kill("SIGKILL"), 20 * 60000);
    try { await Promise.all([done(dump), pipeline(dump.stdout, cipher, createWriteStream(temporary, { flags: "a" }))]); }
    finally { clearTimeout(watchdog); if (dump.exitCode === null) dump.kill(); }
    const tag = await open(temporary, "a");
    try { await tag.write(cipher.getAuthTag()); await tag.sync(); }
    finally { await tag.close(); }
    const file = join(directory, name);
    await rename(temporary, file);
    const bytes = (await stat(file)).size;
    if (!localOnly()) {
      await upload(file, name);
      await prune(directory);
      // The manifest is written last, so its presence (and timestamp) means a complete, uploaded backup. The freshness check relies on that.
      await writeManifest("postgres", { file: name, bytes, sha256: await sha256File(file), keyId: id, database: source.db, ...facts });
    }
    console.log(JSON.stringify({ event: "backup_complete", file: basename(file), bytes, offsite: !localOnly() }));
  } finally {
    await lock.end().catch(() => {});
    await cleanScratch(work);
  }
}

async function authenticate(file, target) {
  const handle = await open(file, "r");
  try {
    const data = Buffer.alloc(headerLimit);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    const end = data.subarray(0, bytesRead).indexOf(10) + 1;
    if (!end) throw new Error("Invalid backup header.");
    const header = data.subarray(0, end);
    const parsed = JSON.parse(header.toString());
    if (parsed.version !== version || !/^[a-f0-9]{24}$/.test(parsed.nonce ?? "")) throw new Error("Unsupported backup format.");
    const { size } = await handle.stat();
    if (size <= end + 16) throw new Error("Incomplete backup.");
    const tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(parsed.id), Buffer.from(parsed.nonce, "hex"));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    await pipeline(createReadStream(file, { start: end, end: size - 17 }), decipher, createWriteStream(target, { flags: "wx", mode: 0o600 }));
  } finally { await handle.close(); }
}

async function restore(input) {
  const target = database(process.env.RESTORE_DATABASE_URL);
  if (!/^dar_restore_[a-z0-9_]+$/.test(target.db) || process.env.RESTORE_CONFIRM !== target.db) throw new Error("A confirmed isolated restore database is required.");
  const source = process.env.BACKUP_DATABASE_URL ? database(process.env.BACKUP_DATABASE_URL) : null;
  if (source?.db === target.db) throw new Error("Backup source and restore target must differ.");
  const directory = spool();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const work = await mkdtemp(join(directory, ".restore-"));
  const db = new pg.Client({ connectionString: target.url.href, connectionTimeoutMillis: 5000 });
  try {
    await db.connect();
    const { rows: [state] } = await db.query(`select current_database() as db,
      (select count(*)::integer from pg_class where relnamespace='public'::regnamespace) as public_objects,
      to_regclass('drizzle.__drizzle_migrations') is not null as has_migrations`);
    if (state.db !== target.db || state.public_objects !== 0 || state.has_migrations) throw new Error("Restore target is not empty.");
    if (!(await db.query("select pg_try_advisory_lock(1627986173) as ok")).rows[0].ok) throw new Error("Another restore is running.");
    let file = resolve(input);
    if (input.startsWith("postgres/")) {
      const name = basename(input);
      if (!filename.test(name) || input !== `postgres/${name}` || localOnly() || !process.env.BACKUP_BUCKET) throw new Error("Invalid remote backup object.");
      file = join(work,name);
      const storage = client();
      try {
        const result = await storage.send(new GetObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: input }), { abortSignal: AbortSignal.timeout(180000) });
        if (!result.Body || !result.ContentLength || result.ContentLength > 5_000_000_000) throw new Error("Invalid remote object size.");
        await pipeline(result.Body, createWriteStream(file,{ flags:"wx", mode:0o600 }));
      } finally { storage.destroy(); }
    }
    const dump = join(work,"restore.dump");
    await authenticate(file, dump);
    const restore = command("pg_restore", target, ["--no-password","--single-transaction","--exit-on-error","--dbname",target.db,dump],
      ["ignore","ignore","ignore"]);
    const watchdog = setTimeout(() => restore.kill("SIGKILL"), 20 * 60000);
    try { await done(restore); } finally { clearTimeout(watchdog); }
    const { rows: [check] } = await db.query(`select (select count(*)::integer from drizzle.__drizzle_migrations) as migrations,
      (select count(*)::integer from public.stores) as stores`);
    console.log(JSON.stringify({ event: "restore_complete", ...check }));
  } finally {
    await db.end().catch(() => {});
    await cleanScratch(work);
  }
}


// ---------------------------------------------------------------------------------------------------------------
// Backup completeness: media objects, manifests, deployment configuration and freshness checks.
// Nothing here ever writes a plaintext secret. Media is encrypted per object with the same key ring as the database
// backups, manifests hold counts, sizes and digests only, and the configuration snapshot holds file hashes and the
// NAMES of environment variables, never their values. Application keys are sealed separately by key-escrow.mjs.
// ---------------------------------------------------------------------------------------------------------------
const objectVersion = "DAR-OBJ-AES256-GCM-1";
const mediaKey = /^[a-f0-9-]{36}\/(?:catalog|theme)\/[a-f0-9-]{36}\.webp$/;
const objectLimit = 25 * 1024 * 1024;
const instructions = [
  "Restore the database only into an empty database named dar_restore_<ticket>, never over a live database.",
  "Run node scripts/ops/backup.mjs restore postgres/<file> with RESTORE_DATABASE_URL, RESTORE_CONFIRM, BACKUP_BUCKET, BACKUP_KEY_ID and BACKUP_KEY or BACKUP_KEYRING.",
  "Restore media with node scripts/ops/backup.mjs media-restore into an empty bucket named dar-<env>-restore-media-<ticket> (RESTORE_MEDIA_BUCKET, RESTORE_MEDIA_CONFIRM).",
  "Application keys are not in this backup. Recover them from the key escrow file with node scripts/ops/key-escrow.mjs open, using the escrow passphrase held separately.",
  "Verify migrations, row counts, row-level security, media references and one decrypted proof before cutover. Runbook: docs/operations/DISASTER_RECOVERY_REPORT.md section 5.",
];

const missing = (error) => error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function sourceClient() {
  return new S3Client({
    endpoint: process.env.BACKUP_SOURCE_S3_ENDPOINT || undefined, region: process.env.BACKUP_SOURCE_REGION ?? process.env.BACKUP_REGION ?? "us-east-1",
    forcePathStyle: process.env.BACKUP_SOURCE_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.BACKUP_SOURCE_AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.BACKUP_SOURCE_AWS_SECRET_ACCESS_KEY ?? "" },
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function restoreClient() {
  return new S3Client({
    endpoint: process.env.RESTORE_MEDIA_S3_ENDPOINT || undefined, region: process.env.RESTORE_MEDIA_REGION ?? "us-east-1",
    forcePathStyle: process.env.RESTORE_MEDIA_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.RESTORE_MEDIA_AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.RESTORE_MEDIA_AWS_SECRET_ACCESS_KEY ?? "" },
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function listAll(storage, bucket, prefix) {
  const found = [];
  let token;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(30_000) });
    for (const object of page.Contents ?? []) found.push({ key: object.Key, size: object.Size ?? 0, etag: object.ETag ?? "", modified: object.LastModified });
    token = page.NextContinuationToken;
  } while (token);
  return found;
}

function sealObject(plain, key) {
  const id = process.env.BACKUP_KEY_ID;
  const nonce = randomBytes(12);
  const header = Buffer.from(JSON.stringify({ version: objectVersion, id, nonce: nonce.toString("hex"), key }) + "\n");
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(id), nonce);
  cipher.setAAD(header);
  return Buffer.concat([header, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function openObject(blob) {
  const end = blob.indexOf(10) + 1;
  if (end < 1 || end > 1024 || blob.length < end + 17) throw new Error("Invalid media backup object.");
  const header = blob.subarray(0, end);
  const parsed = JSON.parse(header.toString());
  if (parsed.version !== objectVersion || !/^[a-f0-9]{24}$/.test(parsed.nonce ?? "") || !mediaKey.test(parsed.key ?? "")) throw new Error("Unsupported media backup object.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(parsed.id), Buffer.from(parsed.nonce, "hex"));
  decipher.setAAD(header);
  decipher.setAuthTag(blob.subarray(-16));
  return { key: parsed.key, plain: Buffer.concat([decipher.update(blob.subarray(end, -16)), decipher.final()]) };
}

async function body(result) {
  const chunks = [];
  for await (const chunk of result.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function writeManifest(kind, details) {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const storage = client();
  try {
    await storage.send(new PutObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: `meta/${kind}-${stamp}.json`, ContentType: "application/json",
      Body: JSON.stringify({ format: "DAR-BACKUP-MANIFEST-1", kind, createdAt, ...details, instructions }, null, 2) }), { abortSignal: AbortSignal.timeout(30_000) });
  } finally { storage.destroy(); }
}

function listDigest(entries) {
  return sha256(entries.map(({ key, sha, size }) => `${key}:${sha}:${size}`).sort().join("\n"));
}

async function mediaBackup() {
  const bucket = process.env.BACKUP_SOURCE_BUCKET;
  if (!bucket) { console.log(JSON.stringify({ event: "media_backup_skipped", reason: "BACKUP_SOURCE_BUCKET is not set" })); return; }
  if (!localOnly() && validateEnv(process.env, "backup").length) throw new Error("Invalid backup environment.");
  const origin = sourceClient();
  const target = client();
  try {
    const objects = (await listAll(origin, bucket, "")).filter((object) => mediaKey.test(object.key));
    let copied = 0, skipped = 0, plainBytes = 0;
    const entries = [];
    async function one(object) {
      if (object.size > objectLimit) throw new Error("A media object exceeds the backup size limit.");
      const key = `media/${object.key}.enc`;
      const current = await target.send(new HeadObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: key })).catch((error) => { if (missing(error)) return null; throw error; });
      const meta = current?.Metadata ?? {};
      if (current && meta.sourceetag === object.etag && Number(meta.sourcesize) === object.size && /^[a-f0-9]{64}$/.test(meta.plainsha256 ?? "")) {
        skipped++; plainBytes += object.size; entries.push({ key: object.key, sha: meta.plainsha256, size: object.size }); return;
      }
      const plain = await body(await origin.send(new GetObjectCommand({ Bucket: bucket, Key: object.key }), { abortSignal: AbortSignal.timeout(60_000) }));
      const digest = sha256(plain);
      await target.send(new PutObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: key, Body: sealObject(plain, object.key), ContentType: "application/octet-stream",
        Metadata: { sourceetag: object.etag, sourcesize: String(object.size), plainsha256: digest } }), { abortSignal: AbortSignal.timeout(60_000) });
      copied++; plainBytes += plain.length; entries.push({ key: object.key, sha: digest, size: plain.length });
    }
    for (let index = 0; index < objects.length; index += 4) await Promise.all(objects.slice(index, index + 4).map(one));
    await writeManifest("media", { keyId: process.env.BACKUP_KEY_ID, objects: entries.length, plainBytes, copied, skipped, listDigest: listDigest(entries), sourceBucket: bucket });
    console.log(JSON.stringify({ event: "media_backup_complete", objects: entries.length, copied, skipped, plainBytes }));
  } finally { origin.destroy(); target.destroy(); }
}

async function mediaRestore() {
  const bucket = process.env.RESTORE_MEDIA_BUCKET;
  if (!bucket || !/^dar-[a-z]+-restore-media-[a-z0-9-]{3,40}$/.test(bucket) || process.env.RESTORE_MEDIA_CONFIRM !== bucket) throw new Error("A confirmed isolated restore bucket is required.");
  if ([process.env.BACKUP_BUCKET, process.env.BACKUP_SOURCE_BUCKET, process.env.S3_BUCKET].includes(bucket)) throw new Error("Restore bucket must differ from live buckets.");
  const target = restoreClient();
  const store = client();
  try {
    if (((await target.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))).KeyCount ?? 0) > 0) throw new Error("Restore bucket is not empty.");
    const manifests = (await listAll(store, process.env.BACKUP_BUCKET, "meta/media-")).sort((a, b) => a.key.localeCompare(b.key));
    const latest = manifests.at(-1);
    if (!latest) throw new Error("No media manifest found.");
    const manifest = JSON.parse((await body(await store.send(new GetObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: latest.key })))).toString());
    const entries = [];
    for (const object of await listAll(store, process.env.BACKUP_BUCKET, "media/")) {
      const { key, plain } = openObject(await body(await store.send(new GetObjectCommand({ Bucket: process.env.BACKUP_BUCKET, Key: object.key }), { abortSignal: AbortSignal.timeout(60_000) })));
      if (`media/${key}.enc` !== object.key) throw new Error("Media backup object does not match its key.");
      await target.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: plain, ContentType: "image/webp" }), { abortSignal: AbortSignal.timeout(60_000) });
      entries.push({ key, sha: sha256(plain), size: plain.length });
    }
    if (entries.length !== manifest.objects || listDigest(entries) !== manifest.listDigest) throw new Error("Restored media does not match the manifest.");
    console.log(JSON.stringify({ event: "media_restore_complete", objects: entries.length, manifest: latest.key }));
  } finally { target.destroy(); store.destroy(); }
}

const trackedFiles = ["Dockerfile", "compose.yaml", "package-lock.json", "infra/Caddyfile", "infra/bootstrap-production.sql", "infra/compose.staging.yaml",
  "infra/dokploy/compose.staging.yaml", "infra/dokploy/README.md", "drizzle/meta/_journal.json"];
const configNames = /^(DAR_|S3_|BACKUP_|RESTORE_|MAIL_|SMTP_|RESEND_|PAYMENT_|PLATFORM_|PUBLIC_|TRUSTED_|OPS_|LEGAL_|APP_ORIGIN$|DATABASE_URL$|IDENTITY_DATABASE_URL$|MEDIA_WORKER_DATABASE_URL$|AWS_)/;

async function configSnapshot() {
  if (!localOnly() && validateEnv(process.env, "backup").length) throw new Error("Invalid backup environment.");
  const files = {};
  for (const path of trackedFiles) {
    try { files[path] = sha256(await readFile(resolve(path))); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  let migrations = null;
  try {
    const journal = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8"));
    migrations = { count: journal.entries.length, last: journal.entries.at(-1)?.tag ?? null };
  } catch { /* The migration journal is not part of this image. */ }
  await writeManifest("config", {
    release: process.env.DAR_RELEASE ?? null, environment: process.env.DAR_ENV ?? null, node: process.version, migrations, files,
    // Names only. Values are never recorded: secrets belong in the secret store and in the sealed key escrow.
    environmentVariableNames: Object.keys(process.env).filter((name) => configNames.test(name)).sort(),
    legalApproved: process.env.LEGAL_APPROVED === "true",
  });
  console.log(JSON.stringify({ event: "config_snapshot_complete", files: Object.keys(files).length }));
}

async function check() {
  const limit = Number(process.env.BACKUP_MAX_AGE_HOURS ?? 26);
  if (!(limit > 0 && limit <= 168)) throw new Error("Invalid maximum backup age.");
  const kinds = ["postgres", ...(process.env.BACKUP_SOURCE_BUCKET ? ["media"] : [])];
  const storage = client();
  try {
    const listed = await listAll(storage, process.env.BACKUP_BUCKET, "meta/");
    const ages = {};
    const stale = [];
    for (const kind of kinds) {
      const times = listed.filter((object) => object.key.startsWith(`meta/${kind}-`) && object.modified).map((object) => object.modified.getTime());
      const age = times.length ? (Date.now() - Math.max(...times)) / 3_600_000 : null;
      ages[kind] = age === null ? null : Number(age.toFixed(4));
      if (age === null || age > limit) stale.push(kind);
    }
    console.log(JSON.stringify({ event: "backup_check", ok: stale.length === 0, maxAgeHours: limit, ageHours: ages }));
    if (stale.length) { await notify("backup_stale", { kinds: stale }); process.exitCode = 1; }
  } finally { storage.destroy(); }
}

// Optional dead-man ping to an external monitor (for example a Healthchecks-style URL). It fires only after a fully
// successful run, so an external service alerts when backups stop arriving, even if this host is down or the timer is off.
async function heartbeat() {
  try {
    const url = new URL(process.env.DAR_HEARTBEAT_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return;
    const response = await fetch(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(5000) });
    await response.body?.cancel();
  } catch { /* A missing or unreachable monitor must not fail a good backup. */ }
}

async function notify(event, extra = {}) {
  console.error(JSON.stringify({ event, ...extra }));
  try {
    const url = new URL(process.env.DAR_ALERT_WEBHOOK ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return;
    const response = await fetch(url,{ method:"POST",redirect:"error",signal:AbortSignal.timeout(3000),
      headers: { "Content-Type":"application/json", ...(process.env.DAR_ALERT_KEY ? { Authorization:`Bearer ${process.env.DAR_ALERT_KEY}` } : {}) },
      body:JSON.stringify({ event, ...extra }) });
    await response.body?.cancel();
  } catch { /* The structured local error remains available. */ }
}

const alert = (operation) => notify("backup_failed", { operation });
const fail = (operation) => async () => { await alert(operation); process.exitCode = 1; };
const operation = process.argv[2];

if (operation === "backup") await backup().then(heartbeat).catch(fail("backup"));
else if (operation === "media") await mediaBackup().catch(fail("media"));
else if (operation === "config") await configSnapshot().catch(fail("config"));
else if (operation === "all") await backup().then(mediaBackup).then(configSnapshot).then(heartbeat).catch(fail("backup"));
else if (operation === "check") await check().catch(fail("check"));
else if (operation === "restore" && process.argv[3]) await restore(process.argv[3]).catch(fail("restore"));
else if (operation === "media-restore") await mediaRestore().catch(fail("media-restore"));
else process.exitCode = 2;
