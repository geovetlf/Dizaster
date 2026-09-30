# Imagen única del backend: el mismo artefacto corre como API (server) o como worker.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @dizaster/core... \
 && pnpm --filter "./packages/*" --filter @dizaster/core run build \
 && pnpm --filter @dizaster/core deploy --prod --legacy /out \
 && cp -r services/core/migrations /out/migrations \
 && find /out/node_modules -path '*geo-tz/data/*' ! -name 'timezones-1970.*' -delete \
 && cp -r data /data

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data
WORKDIR /app
COPY --from=build /out /app
COPY --from=build /data /data
USER node
EXPOSE 8080
# Por defecto la imagen corre la API: vivo = responde /health (ADR 0187). El worker lo cambia en compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--import", "./dist/telemetry.js", "dist/server.js"]
