FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
COPY . .
ENV DAR_LOCAL_BUILD=true
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS pdf
ENV NODE_ENV=production
RUN install -d -o 10001 -g 10001 /run/dar-pdf
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY scripts/render-payment-proof.mjs ./scripts/
COPY scripts/ops/pdf-worker.mjs ./scripts/ops/
USER 10001:10001
CMD ["node","--max-old-space-size=64","scripts/ops/pdf-worker.mjs"]

FROM caddy:2.11.9-alpine AS proxy
RUN chown -R 10001:10001 /data /config
USER 10001:10001

FROM production-dependencies AS staging-storage
RUN npm install --prefix /sandbox --no-audit --no-fund --ignore-scripts s3rver@3.7.1 && install -d -o 10001 -g 10001 /storage
COPY scripts/ops/staging-storage.mjs ./scripts/ops/
USER 10001:10001
CMD ["node","scripts/ops/staging-storage.mjs"]

FROM postgres:18-bookworm AS operations
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && install -d -o 10001 -g 10001 /mail /backups
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
# Non-secret deployment files, so the backup configuration snapshot can record their hashes.
COPY Dockerfile compose.yaml package-lock.json ./
COPY infra ./infra
COPY scripts ./scripts
COPY src ./src
COPY drizzle ./drizzle
USER 10001:10001
ENTRYPOINT []
CMD ["node","scripts/ops/scheduler.mjs"]

FROM base AS app
ENV NODE_ENV=production PORT=3000
RUN install -d -o 10001 -g 10001 /run/dar-pdf /mail /storage
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=staging-storage /sandbox /sandbox
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts ./
COPY drizzle ./drizzle
COPY scripts/ops/validate-env.mjs scripts/ops/dokploy-bootstrap.mjs ./scripts/ops/
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node","scripts/ops/dokploy-bootstrap.mjs"]
