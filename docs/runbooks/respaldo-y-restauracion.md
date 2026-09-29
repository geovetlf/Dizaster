# Respaldo y restauración

Herramientas (ADR 0070):
- `DATABASE_URL=… pnpm db:backup [directorio]` → `pg_dump -Fc` con su `.sha256`.
- `DATABASE_URL=… pnpm db:restore-check [respaldo.dump]` → restaura en una base temporal nueva, compara filas por
  tabla y la última migración, y borra solo esa base temporal. Nunca escribe en la base de origen.

## Rutina
- Diario: respaldo, cifrado y copia a un proveedor distinto del de la base. **Pendiente de infraestructura**: el
  destino (bucket y clave) lo define el propietario.
- Semanal: `db:restore-check` sobre el último respaldo. Un respaldo que no se ha restaurado no cuenta.

## Restaurar tras una pérdida
1. Parar API y worker (evita escrituras sobre una base a medias).
2. Crear una base nueva y restaurar: `pg_restore --no-owner --dbname=<url nueva> <respaldo.dump>`.
3. `pnpm db:migrate` (aplica las migraciones posteriores al respaldo, si las hay).
4. Apuntar `DATABASE_URL` a la base nueva y arrancar. La base dañada no se borra hasta cerrar el incidente.

## Qué no está en la base
- Media (fotos y vídeos) vive en el almacenamiento de objetos: se respalda con el versionado del bucket.
- Las claves (`FIELD_KEYS`, `AUTH_JWT_SECRET`) viven en el gestor de secretos: sin `FIELD_KEYS` las ubicaciones
  cifradas del respaldo no se pueden leer (es intencional).
