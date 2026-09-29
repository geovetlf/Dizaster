# ADR 0009 — Stack y herramientas

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §4.3 (D-01)

## Decisión
- Monorepo pnpm; TypeScript 6.0 (typescript-eslint aún no soporta 7.x); Node 22 LTS.
- Backend: Fastify 5, `pg`, zod 4, jose (JWT). Migraciones SQL propias sin dependencias.
- App: Expo SDK 57, React Native 0.86, Expo Router, MapLibre React Native 11, expo-location, expo-sqlite (cola offline).
- Tests: Vitest; los de integración usan PostgreSQL real con PostGIS + H3.
- Contenedores: `infra/docker/core.Dockerfile` (API y worker) y `infra/docker/db.Dockerfile` (PostGIS + H3).
- Los paquetes internos se consumen desde su código fuente en tests/typecheck/app (`source` condition, `paths` y resolver de Metro) y desde `dist` en el backend compilado.
