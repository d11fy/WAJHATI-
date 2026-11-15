import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
      and not pg_has_role(current_user,'storefront_identity','MEMBER') and not pg_has_role(current_user,'storefront_media_worker','MEMBER') as allowed
      from pg_roles where rolname=current_user`);
    if (!role?.allowed) throw new Error("Dedicated read-only backup login required.");
    if (!(await lock.query("select pg_try_advisory_lock(1627986172) as ok")).rows[0].ok) throw new Error("A backup is already running.");
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
    if (!localOnly()) { await upload(file, name); await prune(directory); }
    console.log(JSON.stringify({ event: "backup_complete", file: basename(file), bytes: (await stat(file)).size, offsite: !localOnly() }));
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

async function alert() {
  console.error(JSON.stringify({ event: "backup_failed", operation: process.argv[2] === "restore" ? "restore" : "backup" }));
  try {
    const url = new URL(process.env.DAR_ALERT_WEBHOOK ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return;
    const response = await fetch(url,{ method:"POST",redirect:"error",signal:AbortSignal.timeout(3000),
      headers: { "Content-Type":"application/json", ...(process.env.DAR_ALERT_KEY ? { Authorization:`Bearer ${process.env.DAR_ALERT_KEY}` } : {}) },
      body:JSON.stringify({event:"backup_failed"}) });
    await response.body?.cancel();
  } catch { /* The structured local error remains available. */ }
}

if (process.argv[2] === "backup") await backup().catch(async () => { await alert(); process.exitCode = 1; });
else if (process.argv[2] === "restore" && process.argv[3]) await restore(process.argv[3]).catch(async () => { await alert(); process.exitCode = 1; });
else process.exitCode = 2;
