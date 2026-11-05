# ADR 0347 — Parches de seguridad de dependencias; se quita la excepción de node-forge

- Estado: Aceptado
- Fecha: 2026-11-05
- Relación con el Blueprint: §20 (gates de seguridad); ADR 0070, 0304, 0305, 0330
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Desde el 2026-11-05 el job `security` de `main` falla. No es un cambio de código: salieron avisos nuevos contra
versiones que ya estaban en el lockfile.

- `pnpm supply-chain audit` (gate de HIGH y CRITICAL): cinco avisos HIGH nuevos de `zod`, `vite` y `node-forge`.
  - `zod` <4.6.6 (GHSA-mrhx) alcanza la validación de entradas de la API, a través de `packages/contracts`.
  - `vite` 8.3.1 (GHSA-587h) en vitest, solo pruebas.
  - `node-forge` 1.4.0: seis avisos HIGH, incluido GHSA-86w9 (excepción del ADR 0304). Todos se corrigen en 1.4.1.
- OSV-Scanner (job `security`, que falla con cualquier aviso, también LOW y MODERATE): además de lo anterior,
  `fastify` 5.12.5 (GHSA-389g, API), `fast-uri` 3.1.8 y 4.2.1 (vía ajv y fastify), `glob` 13 y `minimatch` 10 (solo
  herramientas de desarrollo) y `deepmerge` 4.3.1 (LOW, sin versión corregida, solo `@expo/config`).

## Decisión

- `zod` `^4.6.7` en `packages/contracts` y `services/core`. Es el único cambio que toca código de la API.
- `fastify` `^5.12.6` en `services/core`.
- `pnpm.overrides` en `pnpm-workspace.yaml`:
  - `node-forge: 1.4.2`: corrige todos sus avisos; sigue solo en `@expo/cli`.
  - `vite: 8.3.5`: solo en las pruebas.
  - `zod@<4: 4.6.7`: `@expo/cli` pide zod 3 y su rama 3 no tiene parche. Se probó con `expo config`, `native:check`
    (prebuild Android e iOS) y la suite completa.
  - `fast-uri@<3.1.9: 3.1.9` y `fast-uri@>=4.0.0 <4.2.3: 4.2.3`.
  - `glob@<14.0.2: 14.0.2` y `minimatch@<11.0.1: 11.0.1`: solo dependencias de desarrollo.
- Se quita la excepción de `node-forge` en `security/audit-allowlist.json`, `.trivyignore` y `osv-scanner.toml`.
- La excepción de `braces` (GHSA-vfj7) no cambia. `pnpm audit` y OSV-Scanner ya no la reportan (OSV la marca como
  «unused ignore»), pero no pude consultar la base de avisos de GitHub desde el entorno del agente. Su retirada o
  renovación la decide el propietario antes del 2026-11-07.
- `deepmerge` (LOW, sin versión corregida) no tiene excepción. Bloquea el job `security` de OSV-Scanner hasta que el
  propietario decida. Una excepción acotada requiere su aprobación escrita, como en el ADR 0304.

## Consecuencias

- `pnpm supply-chain audit` pasa: 0 HIGH y 0 CRITICAL. Solo queda `deepmerge` (LOW) en `pnpm audit`.
- `zod` 3 de `@expo/cli` deja de existir en el lockfile.
- Riesgo: `zod` y `fastify` son dependencias de la API; los tests de contratos y core pasan (45 y 799).
  `glob` y `minimatch` cambian de rama mayor en herramientas de desarrollo; el lint y el prebuild pasan.
