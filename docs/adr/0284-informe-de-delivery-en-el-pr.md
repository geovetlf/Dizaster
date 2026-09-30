# ADR 0284 — Informe del Delivery Plane como comentario del PR

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.5 (informe del cambio), fase D1 del plano de entrega; ADR 0264, 0265
- IA: no. Costo: 0 (minutos de Actions incluidos en el plan).

## Contexto

`dzd report` genera desde ADR 0265 un informe en Markdown con el riesgo, los motivos, las migraciones, los paquetes
afectados y los gates de cada cambio. Hasta ahora solo quedaba como artefacto del job `delivery`, porque no existía
el repositorio de GitHub (D-20). El repositorio oficial existe desde el 2026-09-30.

## Decisión

1. Un job nuevo, `report-comment`, publica el informe como **un solo comentario** del PR y lo actualiza en cada push.
   El comentario se reconoce por la marca `<!-- dzd-report -->` y por su autor `github-actions[bot]`.
2. **Mínimo privilegio.** Es el único job de CI con permiso de escritura, y solo `pull-requests: write`. No hace
   checkout ni ejecuta código del PR: descarga el artefacto `delivery-audit` y lo publica como texto. Los demás jobs
   siguen con `contents: read`.
3. **Forks.** En PRs desde un fork GitHub entrega un token de solo lectura, así que el job se omite. El informe sigue
   disponible como artefacto.
4. El comentario se corta en 60 000 caracteres (el límite de GitHub es 65 536).

## Fuera de esta decisión

El resto de la fase D1 sigue esperando al propietario porque cambia la configuración del repositorio:

- protección de `main` y rulesets;
- entornos `staging` y `production`;
- auto-merge de PRs `auto` (`scripts/github-bootstrap.mjs`).

## Consecuencias

- Quien revisa un PR ve el riesgo y los gates sin abrir los artefactos.
- Un push nuevo actualiza el mismo comentario, no agrega otro.
