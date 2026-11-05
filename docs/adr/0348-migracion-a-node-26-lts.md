# ADR 0348 — Migración a Node 26 LTS (ejecuta el ADR 0339)

- Estado: Aceptado
- Fecha: 2026-11-05
- Relación con el Blueprint: §16, §20.7; ADR 0267, 0308, 0339
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones de datos.

## Contexto

- El propietario aprobó el 2026-10-10, con tarjeta de decisión, pasar a Node 26 LTS después del 2026-10-28, con un PR
  que sustituya al #41 (Node 25).
- El ADR 0339 fijó la condición de activación: la última `v26.x` de `nodejs.org/dist/index.json` debe tener un nombre en
  clave LTS. Se cumple con `v26.13.0` («Lithium», 2026-10-28).
- Node 26 no distribuye `corepack`. Se comprobó en el tarball oficial de 26.13.0, que solo trae `node`, `npm` y `npx`.
  `core.Dockerfile` usaba `corepack enable`.

## Decisión

- `.nvmrc`: `22` → `26`.
- `package.json` → `engines.node`: `>=22.12` → `>=26.13.0`.
- `infra/docker/core.Dockerfile`: las dos etapas usan `node:26-bookworm-slim@sha256:add5c17c…f68`, el índice resuelto
  el 2026-11-05. Corepack se sustituye por `npm install -g pnpm@10.33.0` en la etapa de build; la imagen final sigue sin
  npm, npx ni corepack.
- `@types/node` `^22.20.5` → `^26.6.5` en `packages/contracts`, `packages/geo-kit`, `services/core` y `tools/delivery`,
  con su lockfile.
- Los workflows no cambian: leen `.nvmrc` con `node-version-file`.
- El PR #41 (Node 25) queda sustituido por este. Se cierra cuando el propietario fusione este PR, no antes.

## Verificación

- Node 26.13.0 descargado de `nodejs.org` y verificado con `SHASUMS256.txt`. Con él, `pnpm check` completo sobre la rama: contracts 45, delivery 128, geo-kit 39, móvil 318 y core 799 pruebas, todo en verde.
- Dos ajustes que exige el cambio de versión, sin cambiar comportamiento: `@types/node` 26 separa `Http2Stream` de `ServerHttp2Stream`, y un test de APNs se tipó con el segundo; el test de desalineación de `.nvmrc` (ADR 0308) usaba el 22 como valor de partida y ahora parte del 26.
- CI: los 7 checks requeridos, incluido `image`, que construye la imagen con Node 26 y la escanea con Trivy.
- No probado en local: construir la imagen (no hay daemon de Docker en el entorno del agente). Lo cubre el job `image`.

## Rollback

- `git revert` del PR devuelve versión, imagen y tipos a Node 22 a la vez; `check:workflows` lo confirma.
- La imagen con Node 22 sigue en el registro por digest (`dzd rollback` a la revisión anterior).
- No hay cambios de datos ni de esquema.
