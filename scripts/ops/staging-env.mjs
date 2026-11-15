import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";

const directory = resolve(".ops/staging");
const hex = (bytes = 32) => randomBytes(bytes).toString("hex");
const passwords = Object.fromEntries(["admin","owner","runtime","identity","worker","backup"].map((name) => [name,hex(24)]));
const db = (name) => `postgresql://dar_${name}:${passwords[name]}@db:5432/dar_staging`;
const common = { DAR_ENV: "staging", DAR_STAGING_LOCAL: "true", PUBLIC_SIGNUP_ENABLED: "false", APP_ORIGIN: "https://localhost:8443",
  MAIL_PROVIDER: "local", DAR_MAIL_DIR: "/mail", S3_BUCKET: "dar-staging-media-fixture", S3_REGION: "us-east-1",
  S3_ENDPOINT: "http://stage-s3:4569", S3_FORCE_PATH_STYLE: "true", AWS_ACCESS_KEY_ID: "S3RVER", AWS_SECRET_ACCESS_KEY: "S3RVER" };
const values = {
  "app.env": { ...common, DATABASE_URL: db("runtime"), IDENTITY_DATABASE_URL: db("identity"), PLATFORM_MFA_KEY: hex(),
    PAYMENT_PROOF_ACTIVE_KEY: "stage_v1", PAYMENT_PROOF_KEYRING: JSON.stringify({stage_v1:hex()}), OPS_METRICS_TOKEN: hex(), S3_READY_KEY: "ops/readiness" },
  "worker.env": { ...common, MEDIA_WORKER_DATABASE_URL: db("worker") },
  "db.env": { POSTGRES_USER: "dar_admin", POSTGRES_PASSWORD: passwords.admin, POSTGRES_DB: "dar_staging" },
  "operator.env": { MIGRATION_DATABASE_URL: db("owner") },
  "backup.env": { DAR_ENV: "staging", DAR_STAGING_LOCAL: "true", PUBLIC_SIGNUP_ENABLED: "false",
    BACKUP_DATABASE_URL: db("backup"), BACKUP_DIR: "/backups", BACKUP_KEY_ID: "stage_v1", BACKUP_KEY: hex(),
    BACKUP_BUCKET: "dar-staging-backup-fixture", BACKUP_S3_ENDPOINT: "http://stage-s3:4569", BACKUP_S3_FORCE_PATH_STYLE: "true",
    BACKUP_AWS_ACCESS_KEY_ID: "S3RVER", BACKUP_AWS_SECRET_ACCESS_KEY: "S3RVER" },
  "compose.env": { DAR_HOST: "localhost", DAR_ORIGIN: "https://localhost:8443", EDGE_BIND: "127.0.0.1", EDGE_HTTP_PORT: "8080", EDGE_HTTPS_PORT: "8443" },
};
const sql = `
DO $$ BEGIN
  IF current_database()<>'dar_staging' OR to_regclass('public.stores') IS NOT NULL THEN RAISE EXCEPTION 'Expected empty staging database'; END IF;
END $$;
CREATE ROLE storefront_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_identity NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE storefront_media_worker NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE dar_owner LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${passwords.owner}';
CREATE ROLE dar_runtime LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${passwords.runtime}' IN ROLE storefront_app CONNECTION LIMIT 12;
CREATE ROLE dar_identity LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${passwords.identity}' IN ROLE storefront_identity CONNECTION LIMIT 6;
CREATE ROLE dar_worker LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${passwords.worker}' IN ROLE storefront_media_worker CONNECTION LIMIT 5;
CREATE ROLE dar_backup LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${passwords.backup}' IN ROLE pg_read_all_data CONNECTION LIMIT 3;
ALTER ROLE dar_backup SET default_transaction_read_only=on;
ALTER DATABASE dar_staging OWNER TO dar_owner;
REVOKE CONNECT ON DATABASE dar_staging FROM PUBLIC;
GRANT CONNECT ON DATABASE dar_staging TO dar_runtime,dar_identity,dar_worker,dar_backup;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
`;

await mkdir(directory, { recursive: true, mode: 0o700 });
const entries = Object.entries(values).map(([name, env]) => [name,Object.entries(env).map(([key,value]) => `${key}='${value}'`).join("\n") + "\n"]);
entries.push(["bootstrap.sql", sql]);
for (const [name,value] of entries) await writeFile(join(directory,name),value,{flag:"wx",mode:0o600});
console.log("Wrote isolated staging fixture configuration.");
