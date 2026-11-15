#!/usr/bin/env bash
set -euo pipefail

stage=(docker compose --project-name dar-staging --env-file .ops/staging/compose.env -f compose.yaml -f infra/compose.staging.yaml)
"${stage[@]}" config --quiet
"${stage[@]}" up -d --wait --wait-timeout 120 db stage-s3 pdf
if [[ $("${stage[@]}" exec -T db psql -U dar_admin -d dar_staging -Atc "select count(*) from pg_roles where rolname='dar_owner'") == 0 ]]; then
  "${stage[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U dar_admin -d dar_staging < .ops/staging/bootstrap.sql
fi
"${stage[@]}" --profile operator run --rm operator
"${stage[@]}" up -d --wait --wait-timeout 120 app worker proxy

origin=https://localhost:8443
# Use the local Caddy CA for TLS validation. The CA is only for this loopback fixture.
ca=$(mktemp)
trap 'rm -f -- "$ca"' EXIT
for i in {1..15}; do
  if "${stage[@]}" exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > "$ca" 2>/dev/null && [[ -s $ca ]]; then break; fi
  sleep 2
done
[[ -s $ca ]]
curl --fail --silent --show-error --cacert "$ca" "$origin/api/health" | grep -q 'ok'
curl --fail --silent --show-error --cacert "$ca" "$origin/api/ready" | grep -q 'ready'
curl --fail --silent --show-error --cacert "$ca" --dump-header - --output /dev/null "$origin/api/health" | grep -qi '^strict-transport-security: max-age=31536000'
[[ $(curl --silent --show-error --cacert "$ca" --output /dev/null --write-out '%{http_code}' "$origin/api/metrics") == 404 ]]
[[ $(curl --silent --show-error --cacert "$ca" --output /dev/null --write-out '%{http_code}' "$origin/en/sign-up") == 404 ]]
[[ $(curl --silent --show-error --output /dev/null --write-out '%{http_code}' http://localhost:8080/api/health) == 308 ]]
for service in app pdf worker proxy; do
  container=$("${stage[@]}" ps -q "$service")
  [[ $(docker inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}}' "$container") == '10001:10001 true' ]]
done
[[ $(docker inspect -f '{{.HostConfig.NetworkMode}}' "$("${stage[@]}" ps -q pdf)") == none ]]
[[ -z $("${stage[@]}" port db 5432 2>/dev/null || true) ]]

fixture_node=$(command -v node || command -v node.exe)
render_probe='
const http = require("node:http");
const { buffer } = require("node:stream/consumers");
(async () => {
  const body = await buffer(process.stdin);
  const expected = Number(process.argv[1]);
  const req = http.request({socketPath:"/run/dar-pdf/worker.sock",method:"POST",path:"/render",
    headers:{"Content-Type":"application/pdf","Content-Length":body.length}}, async (response) => {
    const bytes = await buffer(response);
    const pages = response.headers["x-rendered-pages"];
    if (response.statusCode !== expected || expected === 200 && (pages !== "3" || bytes.toString("ascii",8,12) !== "WEBP")) process.exitCode = 1;
    console.log(`PDF socket returned ${response.statusCode} (${pages ?? "no"} pages)`);
  });
  req.setTimeout(12000, () => req.destroy());
  req.on("error", () => { process.exitCode = 1; });
  req.end(body);
})().catch(() => { process.exitCode = 1; });'
for pages in 3 4; do
  expected=415; [[ $pages != 3 ]] || expected=200
  "$fixture_node" --input-type=module -e 'import {receiptPdf} from "./tests/fixtures/receipt.mjs"; process.stdout.write(receiptPdf(Array.from({length:Number(process.argv[1])}, (_, i) => `Fixture ${i+1}`)));' "$pages" |
    "${stage[@]}" exec -T app node -e "$render_probe" "$expected"
done
printf 'Not a PDF' | "${stage[@]}" exec -T app node -e "$render_probe" 415

"${stage[@]}" --profile backup run --rm backup
"${stage[@]}" stop pdf
[[ $(curl --silent --show-error --cacert "$ca" --output /dev/null --write-out '%{http_code}' "$origin/api/ready") == 503 ]]
curl --fail --silent --show-error --cacert "$ca" "$origin/api/health" | grep -q 'ok'
"${stage[@]}" up -d --wait --wait-timeout 120 pdf
curl --fail --silent --show-error --cacert "$ca" "$origin/api/ready" | grep -q 'ready'
echo 'Staging containers passed HTTPS, readiness, access and sandbox checks.'
