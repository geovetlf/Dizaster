# ADR 0264 — CI endurecido: permisos mínimos, acciones fijadas y escáneres en cada ejecución

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.7, §20.8, §13.1 (cadena de suministro); ADR 0070, 0218, 0260
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La auditoría del plano de entrega (ADR 0260) encontró: `ci.yml` sin bloque `permissions:` (el `GITHUB_TOKEN` quedaba
con los permisos por defecto del repositorio), acciones referenciadas por etiqueta (`@v4`, que su autor puede mover),
`pnpm check:secrets` presente en `pnpm check` pero no en CI, y `eas-cli@latest` sin versión fija en el build móvil.

## Decisión

- `permissions: contents: read` en la raíz de cada workflow.
- Toda acción externa fijada por SHA de commit completo, con la etiqueta como comentario (`# v4`). Dependabot
  (`github-actions`, mensual) propone las actualizaciones de SHA.
- `eas-cli` con versión exacta (24.8.0 al 2026-09-30); se actualiza a mano junto con el SDK de Expo.
- CI corre `pnpm check:secrets` y el nuevo `pnpm check:workflows` (`scripts/check-workflows.mjs`), que falla si un
  workflow no declara `permissions:`, usa una acción sin SHA o una herramienta con `@latest`. También está en
  `pnpm check`.

## Consecuencias

- Una etiqueta movida por un tercero ya no cambia lo que corre en CI.
- Los SHA se obtuvieron con `git ls-remote` de los repositorios oficiales de cada acción.
