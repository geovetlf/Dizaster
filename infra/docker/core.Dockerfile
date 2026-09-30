# Imagen única del backend: el mismo artefacto corre como API (server) o como worker.
# Imagen base fijada por digest (ADR 0273): Dependabot (docker) propone la actualización.
FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @dizaster/core... \
 && pnpm --filter "./packages/*" --filter @dizaster/core run build \
 && pnpm --filter @dizaster/core deploy --prod --legacy /out \
 && cp -r services/core/migrations /out/migrations \
 && find /out/node_modules -path '*geo-tz/data/*' ! -name 'timezones-1970.*' -delete \
 && cp -r data /data

FROM node:26-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2
ENV NODE_ENV=production DATA_DIR=/data
# La imagen solo ejecuta node: sin npm, npx, corepack ni yarn (npm trae dependencias con avisos HIGH, ADR 0267).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /data /data
USER node
EXPOSE 8080
# Por defecto la imagen corre la API: vivo = responde /health (ADR 0187). El worker lo cambia en compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "./dist/telemetry.js", "dist/server.js"]
