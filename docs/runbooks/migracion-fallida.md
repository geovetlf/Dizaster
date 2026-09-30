# Runbook — Migración fallida o incompatible (rollback de base de datos)

ADR 0273, Blueprint §20.15. El rollback de la aplicación (`dzd rollback`) solo mueve tráfico; la base de datos **no
se revierte automáticamente nunca**.

## Principio: expandir y contraer

Las migraciones son compatibles hacia atrás: la versión anterior de la app debe funcionar con el esquema nuevo.
`dzd policy` bloquea lo que rompe esa regla (DROP, RENAME, cambio de tipo, TRUNCATE/DELETE de tablas no derivadas,
editar una migración aplicada) y el migrador se detiene si una migración aplicada cambió (checksum). Quitar algo se
hace en dos entregas: primero se deja de usar (expandir), después, cuando ya no hay ninguna versión que lo lea, se
quita (contraer), con aprobación del propietario.

## 1. La migración falló al aplicarse

Cada archivo corre en su transacción: si falla, no queda nada a medias y el candado se libera.

1. El job de migraciones sale con error; el despliegue no continúa (el digest nuevo no recibe tráfico).
2. Leer el error (`dzd diagnose --log …`). Corregir con una migración **nueva** que reemplace a la fallida si esta
   aún no se aplicó en ningún entorno; si ya se aplicó en alguno, nunca editarla: otra migración encima.
3. Volver a pasar gates y staging.

## 2. Se aplicó y la versión nueva falla

1. `dzd rollback --env <entorno>`: el tráfico vuelve a la versión anterior, compatible con el esquema nuevo por la
   regla de expandir y contraer. El comando dice hasta qué migración es compatible.
2. Arreglar hacia delante (forward-fix) con una migración nueva y un despliegue normal.

## 3. La migración dañó datos (último recurso)

Solo con decisión del propietario: restaurar implica perder lo escrito desde el respaldo.

1. Congelar escrituras si hace falta (kill switches, `docs/runbooks/presupuesto-y-kill-switches.md`).
2. Tomar un respaldo del estado actual antes de tocar nada (`scripts/db-backup.sh`): nunca se borra un respaldo.
3. Restaurar en una base nueva (`docs/runbooks/respaldo-y-restauracion.md`), comprobar con
   `pnpm db:restore-check`, y cambiar la conexión. La base dañada se conserva hasta que el propietario decida.
4. Reaplicar lo perdido si es posible (outbox, cola offline de la app) y registrar el incidente
   (`docs/runbooks/respuesta-a-incidentes.md`).

`destroy-infra` y `migrate-production` son OWNER_ONLY en `dzd autonomy`; `delete-backup` está prohibido para la
automatización.
