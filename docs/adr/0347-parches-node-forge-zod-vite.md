# ADR 0347 — Parches de node-forge, zod y vite; se quita la excepción de node-forge

- Estado: Aceptado
- Fecha: 2026-11-05
- Relación con el Blueprint: §20 (gates de seguridad); ADR 0070, 0304, 0305, 0330
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

El 2026-11-05 `node scripts/supply-chain.mjs audit` (pnpm audit de producción) fallaba en `main` con cinco avisos HIGH
nuevos y uno de `node-forge` que ya tenía versión corregida:

| Paquete | Avisos HIGH | Versión corregida | Ruta | Afecta a |
| --- | --- | --- | --- | --- |
| `node-forge` ≤1.4.0 | 6 (incluido GHSA-86w9, excepción ADR 0304) | 1.4.1+ (ninguna para GHSA-86w9, pero 1.4.1+ queda fuera de su rango) | `@expo/cli` | herramienta de desarrollo |
| `vite` 8.3.0–8.3.2 | 1 (GHSA-587h) | 8.3.3 | `vitest` | pruebas |
| `zod` <4.6.6 | 1 (GHSA-mrhx) | 4.6.6 | `packages/contracts` y `services/core` | **API** (validación de entradas) |
| `zod` 3.25.76 | (mismo aviso) | ninguna en la rama 3 | `@expo/cli` | herramienta de desarrollo |

`braces` 3.0.3 (GHSA-vfj7, excepción ADR 0304) ya no aparece en `pnpm audit`. No pude confirmarlo en la base de
avisos de GitHub desde el entorno del agente, así que su excepción se mantiene sin cambios hasta su revisión.

## Decisión

- `zod` sube a `^4.6.7` en `packages/contracts` y `services/core`. Es el único cambio que toca el código de la API.
- `pnpm.overrides` en `pnpm-workspace.yaml`:
  - `node-forge: 1.4.2`, corrige todos sus avisos y sigue sin entrar en la imagen de la API ni en el bundle;
  - `vite: 8.3.5`, solo en las pruebas;
  - `zod@<4: 4.6.7`: `@expo/cli` fuerza zod 3 y su rama 3 no tiene parche. Se probó con `expo config`, `native:check`
    (prebuild Android e iOS) y la suite completa.
- Se quita la excepción de `node-forge` en `security/audit-allowlist.json`, `.trivyignore` y `osv-scanner.toml`. Ya no
  hace falta. La de `braces` no cambia.
- `zod` 3 en `@expo/cli` no tiene excepción: el override la elimina. Si un día vuelve a aparecer un aviso de zod sin
  corregir, se decide con el propietario antes de añadir nada.

## Consecuencias

- `pnpm supply-chain` pasa con 0 HIGH y 0 CRITICAL pendientes. Quedan 6 avisos LOW y 6 MODERATE de `fast-uri`, `glob`,
  `minimatch`, `deepmerge` y `fastify` (ninguno HIGH; no gobernados por el gate).
- La excepción de `braces` vence el 2026-11-07 (`osv-scanner.toml` y `.trivyignore`); la revisión del propietario sigue
  pendiente. Si el aviso ya no existe en la base de datos, la excepción puede retirarse en otro PR.
- ADR 0304 y 0330 quedan superadas en lo que toca a `node-forge`.
