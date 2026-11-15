import { createRequire } from "node:module";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const require = createRequire("/sandbox/package.json");
const S3rver = require("s3rver");
const buckets = ["dar-staging-media-fixture","dar-staging-backup-fixture"];
const server = new S3rver({ address: "0.0.0.0", port: 4569, directory: "/storage", silent: true, vhostBuckets: false,
  configureBuckets: buckets.map((name) => ({ name })) });
let ready = false;
server.middleware.unshift(async (ctx,next) => {
  if (ctx.path === "/health" && ctx.method === "GET" && ["127.0.0.1","::ffff:127.0.0.1"].includes(ctx.ip)) {
    ctx.status = ready ? 200 : 503; return;
  }
  const valid = /^\/dar-staging-(?:media|backup)-fixture(?:\/(?:ops\/readiness|[a-f0-9-]{36}\/(?:catalog|theme)\/[a-f0-9-]{36}\.webp|postgres\/dar-backup-[A-Za-z0-9-]+\.enc))?\/?$/.test(ctx.path);
  if (!valid || ctx.get("origin") || !["HEAD","GET","PUT","DELETE"].includes(ctx.method) || Object.keys(ctx.query).some((key)=>key!=="x-id")) {
    ctx.status=405; return;
  }
  await next();
});
await server.run();
const client = new S3Client({endpoint:"http://127.0.0.1:4569",region:"us-east-1",forcePathStyle:true,
  credentials:{accessKeyId:"S3RVER",secretAccessKey:"S3RVER"},requestChecksumCalculation:"WHEN_REQUIRED"});
await client.send(new PutObjectCommand({ Bucket:buckets[0],Key:"ops/readiness",Body:"staging fixture" }));
ready = true;
client.destroy();
for(const signal of ["SIGINT","SIGTERM"]) process.once(signal,()=>void server.close());
