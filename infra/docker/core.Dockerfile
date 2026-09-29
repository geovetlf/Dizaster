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
CMD ["node", "dist/server.js"]
