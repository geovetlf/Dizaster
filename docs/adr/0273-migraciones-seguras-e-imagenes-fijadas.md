# ADR 0273 — Migrador con candado y checksum, runbook de migración fallida e imágenes base fijadas

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.10, §20.15; ADR 0265, 0267, 0272
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La auditoría del Delivery Plane encontró: el migrador no impedía dos ejecuciones simultáneas (dos réplicas del job)
ni detectaba que una migración ya aplicada hubiera cambiado; no había procedimiento para una migración mala (solo
para restaurar tras pérdida); las imágenes base se referían por etiqueta; CI fijaba `node-version: 22` a mano en vez
de `.nvmrc`.

## Decisión

- `platform/migrate.ts`: candado de sesión `pg_advisory_lock` durante toda la ejecución, sobre la misma conexión
  que aplica (no depende del tamaño del pool); columna `checksum` (sha256) en `platform.schema_migrations`, rellenada
  para las filas antiguas; si una migración aplicada cambió, se detiene antes de aplicar nada. Probado en una base
  temporal propia (`test/migrate-runner.test.ts`): dos migradores simultáneos, edición detectada, fallo sin restos.
- `docs/runbooks/migracion-fallida.md`: expandir y contraer, falla al aplicar, falla después (rollback de tráfico +
  forward-fix) y restauración como último recurso, solo con decisión del propietario.
- `FROM` por digest en `core.Dockerfile` y `db.Dockerfile` (Dependabot `docker` los actualiza); `check:workflows`
  lo exige. CI y el build móvil usan `node-version-file: .nvmrc`.
