// Restore drill: proves the newest encrypted off-host backup can be decrypted and restored, and measures how long it takes.
// It never touches the live database. It restores into a throwaway database named dar_restore_drill, compares the result
// with the live database (table and migration counts), then drops the throwaway database.
//
// Required environment (all supplied by the `drill` profile in infra/dokploy/compose.production.yaml):
//   DRILL_ADMIN_URL            superuser login on the same server, used only to create and drop dar_restore_drill
//   BACKUP_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_REGION, BACKUP_AWS_ACCESS_KEY_ID, BACKUP_AWS_SECRET_ACCESS_KEY
//   BACKUP_KEY_ID, BACKUP_KEY  (or BACKUP_KEYRING)
//   BACKUP_DIR                 private scratch directory
import { spawn } from "node:child_process";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";

const scratch = "dar_restore_drill";
const name = /^postgres\/dar-backup-\d{8}T\d{6}Z-[0-9a-f]{8}\.enc$/;

function fail(message) {
  console.error(JSON.stringify({ event: "restore_drill_failed", reason: message }));
  process.exitCode = 1;
}

async function newestBackup() {
  const storage = new S3Client({
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined, region: process.env.BACKUP_REGION ?? "us-east-1",
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY ?? "" },
    maxAttempts: 2, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
  });
  try {
    const found = [];
    let token;
    do {
      const page = await storage.send(new ListObjectsV2Command({ Bucket: process.env.BACKUP_BUCKET, Prefix: "postgres/dar-backup-", ContinuationToken: token }), { abortSignal: AbortSignal.timeout(30_000) });
      for (const object of page.Contents ?? []) if (name.test(object.Key ?? "")) found.push({ key: object.Key, size: object.Size ?? 0 });
      token = page.NextContinuationToken;
    } while (token);
    found.sort((a, b) => a.key.localeCompare(b.key));
    return found.at(-1);
  } finally { storage.destroy(); }
}

const counts = async (client) => (await client.query(`select
  (select count(*)::integer from pg_tables where schemaname='public') as tables,
  (select count(*)::integer from drizzle.__drizzle_migrations) as migrations,
  (select count(*)::integer from pg_policies where schemaname='public') as policies,
  (select count(*)::integer from pg_proc where pronamespace='public'::regnamespace) as functions`)).rows[0];

async function run() {
  if (!process.env.DRILL_ADMIN_URL) return fail("DRILL_ADMIN_URL is required");
  const adminUrl = new URL(process.env.DRILL_ADMIN_URL);
  const liveName = adminUrl.pathname.slice(1);
  if (!/^dar_(production|staging)$/.test(liveName)) return fail("the admin URL must name the live database");
  const scratchUrl = new URL(adminUrl); scratchUrl.pathname = `/${scratch}`;

  const started = Date.now();
  const newest = await newestBackup();
  if (!newest) return fail("no backup object found");

  const admin = new pg.Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 5000 });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${scratch}`);
    await admin.query(`create database ${scratch}`);
    const live = await counts(admin);

    const restoreStarted = Date.now();
    const child = spawn(process.execPath, ["scripts/ops/backup.mjs", "restore", newest.key], {
      env: { ...process.env, RESTORE_DATABASE_URL: scratchUrl.href, RESTORE_CONFIRM: scratch, BACKUP_DATABASE_URL: "" },
      stdio: ["ignore", "pipe", "inherit"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => child.once("exit", resolve));
    if (code !== 0) return fail("restore command failed");
    const restoreSeconds = Math.round((Date.now() - restoreStarted) / 100) / 10;

    const copy = new pg.Client({ connectionString: scratchUrl.href, connectionTimeoutMillis: 5000 });
    await copy.connect();
    let restored;
    try { restored = await counts(copy); } finally { await copy.end(); }

    const same = ["tables", "migrations", "policies", "functions"].every((key) => restored[key] === live[key]);
    console.log(JSON.stringify({
      event: same ? "restore_drill_passed" : "restore_drill_mismatch", backup: newest.key.replace("postgres/", ""), backupBytes: newest.size,
      live, restored, restoreSeconds, totalSeconds: Math.round((Date.now() - started) / 100) / 10, restoreOutput: output.trim().split("\n").at(-1),
    }));
    if (!same) process.exitCode = 1;
  } finally {
    await admin.query(`drop database if exists ${scratch}`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

run().catch((error) => fail(error instanceof Error ? error.name : "unknown"));
