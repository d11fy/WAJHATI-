import { spawn } from "node:child_process";
import { createHmac, randomBytes, scrypt } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

function deriveHex(secret, label, bytes = 32) {
  return createHmac("sha256", secret).update(`wajhati:${label}`).digest("hex").slice(0, bytes * 2);
}

function hashPasswordScrypt(password) {
  const salt = randomBytes(16);
  const options = { N: 32_768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, key) => {
      if (error) reject(error);
      else resolve(`scrypt-v1$${salt.toString("hex")}$${key.toString("hex")}`);
    });
  });
}

function buildRoleUrl(baseUrl, username, password) {
  const url = new URL(baseUrl);
  url.username = username;
  url.password = password;
  return url.toString();
}

async function startEmbeddedS3IfNeeded(env) {
  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) return;
  try {
    const require = createRequire("/sandbox/package.json");
    const S3rver = require("s3rver");
    const bucket = env.S3_BUCKET || "dar-market-local";
    const server = new S3rver({
      address: "127.0.0.1",
      port: 4569,
      directory: "/storage",
      silent: true,
      vhostBuckets: false,
      configureBuckets: [{ name: bucket }],
    });
    await server.run();
    env.S3_BUCKET = bucket;
    env.S3_REGION = env.S3_REGION || "us-east-1";
    env.S3_ENDPOINT = "http://127.0.0.1:4569";
    env.S3_FORCE_PATH_STYLE = "true";
    env.AWS_ACCESS_KEY_ID = "S3RVER";
    env.AWS_SECRET_ACCESS_KEY = "S3RVER";
    console.log(`[dokploy-bootstrap] Embedded S3 storage listening on 127.0.0.1:4569 (bucket: ${bucket})`);
  } catch (error) {
    console.warn("[dokploy-bootstrap] Embedded S3 storage skipped:", error?.message ?? error);
  }
}

async function provisionDatabase(env) {
  const rawUrl = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
  if (!rawUrl) {
    console.warn("[dokploy-bootstrap] No DATABASE_URL provided yet.");
    return;
  }

  const secretSeed = env.PLATFORM_MFA_KEY || rawUrl;
  env.PLATFORM_MFA_KEY ||= deriveHex(secretSeed, "mfa-key", 32);
  env.SMTP_CONFIG_KEY ||= deriveHex(secretSeed, "smtp-key", 32);
  env.PAYMENT_PROOF_KEY ||= deriveHex(secretSeed, "proof-key", 32);
  env.TRUSTED_CLIENT_IP_HEADER ||= "x-real-ip";
  env.PUBLIC_SIGNUP_ENABLED ||= "true";

  const adminClient = new pg.Client({ connectionString: rawUrl, connectionTimeoutMillis: 10_000 });
  await adminClient.connect();

  try {
    const { rows: [info] } = await adminClient.query(`
      select current_user as user, current_database() as db,
             (select rolsuper or rolcreaterole from pg_roles where rolname = current_user) as can_provision
    `);

    if (!info?.can_provision) {
      console.log("[dokploy-bootstrap] Connected with restricted role; skipping superuser role provisioning.");
      return;
    }

    const ownerPass = deriveHex(secretSeed, "role:dar_owner", 24);
    const runtimePass = deriveHex(secretSeed, "role:dar_runtime", 24);
    const identityPass = deriveHex(secretSeed, "role:dar_identity", 24);
    const mediaPass = deriveHex(secretSeed, "role:dar_media", 24);

    const existing = new Set((await adminClient.query("select rolname from pg_roles")).rows.map((r) => r.rolname));
    const groupRoles = ["storefront_app", "storefront_identity", "storefront_media_worker"];
    for (const role of groupRoles) {
      if (!existing.has(role)) {
        await adminClient.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
      }
    }

    const loginRoles = [
      ["dar_owner", ownerPass, ""],
      ["dar_runtime", runtimePass, "IN ROLE storefront_app"],
      ["dar_identity", identityPass, "IN ROLE storefront_identity"],
      ["dar_media", mediaPass, "IN ROLE storefront_media_worker"],
    ];

    for (const [role, pass, membership] of loginRoles) {
      if (!existing.has(role)) {
        await adminClient.query(`CREATE ROLE ${role} PASSWORD '${pass}' LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE ${membership}`);
      } else {
        await adminClient.query(`ALTER ROLE ${role} PASSWORD '${pass}' LOGIN INHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
      }
    }

    const dbIdent = `"${String(info.db).replace(/"/g, '""')}"`;
    await adminClient.query(`GRANT CONNECT ON DATABASE ${dbIdent} TO dar_owner, dar_runtime, dar_identity, dar_media`);
    await adminClient.query(`ALTER SCHEMA public OWNER TO dar_owner`);
    await adminClient.query(`GRANT USAGE, CREATE ON SCHEMA public TO dar_owner`);
    await adminClient.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);

    const ownerUrl = buildRoleUrl(rawUrl, "dar_owner", ownerPass);
    const runtimeUrl = buildRoleUrl(rawUrl, "dar_runtime", runtimePass);
    const identityUrl = buildRoleUrl(rawUrl, "dar_identity", identityPass);

    console.log("[dokploy-bootstrap] Running Drizzle SQL migrations as dar_owner...");
    const ownerPool = new pg.Pool({ connectionString: ownerUrl, max: 2 });
    try {
      const db = drizzle(ownerPool);
      await migrate(db, { migrationsFolder: "./drizzle" });
      console.log("[dokploy-bootstrap] Migrations complete.");

      if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD && String(env.ADMIN_PASSWORD).length >= 12) {
        const email = String(env.ADMIN_EMAIL).trim().toLowerCase();
        const name = String(env.ADMIN_NAME || "Platform Owner").trim();
        const hash = await hashPasswordScrypt(String(env.ADMIN_PASSWORD));
        const { rows: [userRow] } = await ownerPool.query(
          `INSERT INTO public.users (name, email, password_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
           RETURNING id`,
          [name, email, hash],
        );
        if (userRow?.id) {
          await ownerPool.query(
            `INSERT INTO public.platform_roles (user_id, role)
             VALUES ($1, 'owner')
             ON CONFLICT (user_id) DO UPDATE SET role = 'owner'`,
            [userRow.id],
          );
          await ownerPool.query(
            `INSERT INTO public.billing_verified_accounts (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [userRow.id],
          );
          console.log(`[dokploy-bootstrap] Ensured platform owner account: ${email}`);
        }
      }
    } finally {
      await ownerPool.end();
    }

    env.DATABASE_URL = runtimeUrl;
    env.IDENTITY_DATABASE_URL = identityUrl;
    delete env.MIGRATION_DATABASE_URL;
    delete env.MEDIA_WORKER_DATABASE_URL;
    delete env.BACKUP_DATABASE_URL;
  } finally {
    await adminClient.end();
  }
}

async function main() {
  if (process.env.DAR_ENV === "staging" || process.env.DAR_ENV === "production") {
    const validator = spawn(process.execPath, ["scripts/ops/validate-env.mjs", "app"], { stdio: "inherit", env: process.env });
    const code = await new Promise((resolve) => validator.once("exit", resolve));
    if (code !== 0) process.exit(code ?? 1);
  } else {
    try {
      await provisionDatabase(process.env);
      await startEmbeddedS3IfNeeded(process.env);
    } catch (error) {
      console.error("[dokploy-bootstrap] Bootstrap warning:", error?.message ?? error);
    }
  }

  const nextBin = "node_modules/next/dist/bin/next";
  const child = spawn(process.execPath, [nextBin, "start", "--hostname", "0.0.0.0", "--port", process.env.PORT || "3000"], {
    stdio: "inherit",
    env: process.env,
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code) => process.exit(code ?? 0));
}

void main();

