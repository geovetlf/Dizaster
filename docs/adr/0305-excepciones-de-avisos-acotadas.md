# ADR 0305 — Excepciones de avisos acotadas a versión y ruta, con aviso previo al vencimiento

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §20 (gates de seguridad); ADR 0070, 0304
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La excepción temporal de ADR 0304 (`node-forge` y `braces`, sin versión corregida publicada) se aceptaba en
`pnpm supply-chain` solo por el ID del aviso. Si mañana el backend o la app empezaran a depender de `node-forge`
directamente, el mismo ID seguiría aceptado y el gate no lo vería. Revisión del 2026-10-10:

| Paquete | Última versión publicada | Ruta real (`pnpm audit --prod`) |
| --- | --- | --- |
| `node-forge` | 1.4.0 (afectada) | `apps__mobile>expo>@expo/cli>node-forge` |
| `braces` | 3.0.3 (afectada) | `apps__mobile>expo>@expo/cli>@expo/metro-file-map>micromatch>braces` |

Sigue sin existir arreglo upstream, así que la excepción no puede quitarse todavía.

## Decisión

- Cada entrada de `security/audit-allowlist.json` declara `package`, `versions` y `paths` (rutas de `pnpm audit`, con
  `*` para un tramo intermedio). Un aviso solo queda aceptado si coinciden el ID, el paquete, **todas** las versiones
  instaladas y **todas** las rutas. Otra versión, otra ruta o un aviso sin hallazgos vuelve a bloquear.
- `braces` queda limitado a rutas dentro de `@expo/cli`; el motivo se corrige (no llega por Jest en producción).
- Catorce días antes de `reviewBy`, el job `supply-chain` emite un `::warning::` en cada ejecución, visible en el PR.
- El vencimiento sigue automático en los tres escáneres: `reviewBy` 2026-11-06 en pnpm audit, `exp:2026-11-07` en
  Trivy e `ignoreUntil` 2026-11-07 en OSV. Trivy y OSV no permiten acotar por ruta; por eso la acotación vive en
  `pnpm supply-chain`, que corre en el mismo CI.

## Consecuencias

- La excepción no puede extenderse en silencio a otro paquete, versión o consumidor.
- La revisión del 2026-11-07 queda anunciada en CI desde el 2026-10-23, además del recordatorio del 5 de noviembre.
- Pruebas: `services/core/test/supply-chain.test.ts`.
