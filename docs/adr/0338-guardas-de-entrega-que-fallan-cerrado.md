# ADR 0338 — Guardas de entrega que fallan cerrado: autonomía antes de migrar, resultado de política y workflows

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §20.7, §20.11, §20.13, §20.20, §20.23; ADR 0262, 0264, 0272, 0277, 0283, 0303, 0306
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones. El nivel de autonomía sigue en 2.

## Contexto

Auditoría del 2026-10-11 de `dzd`, el Delivery Agent y los workflows. Huecos reales encontrados:

1. **La autonomía se comprobaba después de migrar.** En `deliver.yml`, el job `staging` migraba la base
   (`gcloud run jobs execute migrate`) antes de `dzd deploy`, que era el único paso que miraba el nivel de
   autonomía. El entorno `staging` no tiene revisor obligatorio. Por eso, un actor que no es owner y puede lanzar el
   workflow (un bot) migraba staging y recién después lo detenía `dzd deploy`. En producción lo cubre la aprobación
   del entorno, pero se aplica el mismo orden.
2. **El resultado de la política era opcional y fallaba abierto.**
   - `dzd deploy` y `dzd promote` tomaban `--outcome` de quien llama, con `auto` por omisión.
   - `decide()` trataba como `auto` cualquier valor desconocido (`--outcome aproval`).
   - Un nivel no numérico (`dzd autonomy --level abc` → `NaN`) pasaba, porque `NaN < 4` es falso.
   - Con un nivel futuro de 4 o 5, la automatización podía promover un cambio crítico con solo omitir la bandera.
   - El ejecutor del agente decidía con la política, pero el `dzd promote` que lanzaba volvía a decidir con `auto`.
3. **Trazabilidad incompleta.** Los registros de auditoría de `deploy`, `promote`, `rollback` y `agent run` no
   guardaban el commit ni la ejecución de CI.
4. **Workflows.**
   - `check:workflows` exigía `permissions:` en la raíz, pero aceptaba `write-all`.
   - No vigilaba `id-token: write`, `timeout-minutes`, `pull_request_target` ni `workflow_run`.
   - No vigilaba la interpolación de entradas en scripts: `mobile-build.yml` ponía `${{ inputs.platform }}` dentro
     de `run:`.
   - Nada impedía que un cambio quitara de `deliver.yml` el entorno `production` (la aprobación del propietario) o
     la guarda de ADR 0303 y 0306 sin que CI lo notara.
   - En `ci.yml`, `cancel-in-progress: true` también cancelaba ejecuciones de `main`: un commit podía quedarse sin
     imagen firmada ni resultado.

## Decisión

- **`dzd guard --action <acción> --actor <actor>`.** Es una comprobación previa con el nivel de la política: no
  admite `--level`. En CI, `human` no cuenta.
  - El job `staging` de `deliver.yml` la corre para `migrate-staging` y `deploy-staging` antes de autenticarse en Google
    Cloud y de migrar.
  - El job `production` la corre para `migrate-production` y `promote-production --outcome approval`.
  - Con el nivel 2, solo un owner pasa, igual que antes, pero ahora sin efectos previos.
- **Fallar cerrado.**
  - `decide()` rechaza un nivel que no sea entero 0–5, un resultado de política desconocido y una acción desconocida.
  - `dzd deploy` y `dzd promote` rechazan un `--outcome` desconocido.
  - Sin `--outcome`, producción cuenta `approval`.
  - El ejecutor del agente pasa a `deploy` y `promote` el resultado que calculó con la política del repositorio. El
    agente no puede ponerlo: `outcome` no está entre sus banderas.
- **Trazabilidad.** Cada registro de auditoría de `deploy`, `promote`, `rollback` y `agent run` lleva `commit`, `ref`
  y `runId` de CI cuando existen.
- **`check:workflows`** exige además:
  - permisos de solo lectura en la raíz;
  - `id-token: write` solo en `ci.yml/image` y `deliver.yml/staging|production`;
  - `timeout-minutes` en cada job;
  - ningún `pull_request_target` ni `workflow_run`;
  - ninguna entrada no confiable (`inputs.*`, `github.event.*`, `github.head_ref`) dentro de un script;
  - en `deliver.yml`: concurrencia sin cancelar, guarda que lee `production`, `staging` con `needs: guard` y su
    entorno, `production` con `needs: staging` y `environment: production`, promoción con `--outcome approval` y
    `dzd guard` antes de las migraciones.
- `mobile-build.yml` pasa las entradas por `env:`.
- `ci.yml` cancela ejecuciones anteriores solo en PRs.
- Pruebas nuevas:
  - `tools/delivery/test/guards.test.ts`: autonomía que falla cerrado, promoción sin `--outcome`, cambio de bajo
    riesgo que avanza sin saltarse staging verificado ni la firma, `dzd guard`, rollback por CLI y trazabilidad;
  - `tools/delivery/test/workflows.test.ts`: cada regla de `check:workflows` rechaza el cambio que debe rechazar,
    sobre una copia del repositorio.

## Consecuencias

- No cambia el nivel de autonomía (2), la aprobación obligatoria de producción ni la guarda de entornos. Todo
  aprieta, nada se relaja.
- Quitar una de estas guardas exige cambiar `scripts/check-workflows.mjs` en el mismo PR. Ese archivo es `critical`
  en la política, así que el cambio queda a la vista y requiere aprobación.
- El resultado de la política sigue declarándolo quien llama a `dzd deploy`/`promote`. `dzd` no puede calcularlo por
  su cuenta, porque no sabe qué commits entran en un digest. Riesgo residual: una automatización con nivel 5 que
  declare `--outcome auto` en falso. Antes de subir a 5, el digest tiene que llevar la clase de riesgo en su
  procedencia (ADR futuro).
