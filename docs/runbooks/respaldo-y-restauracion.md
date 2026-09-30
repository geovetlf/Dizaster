# Respaldo y restauración

Herramientas (ADR 0070, ADR 0189):
- `DATABASE_URL=… BACKUP_AGE_RECIPIENTS="age1…" pnpm db:backup [directorio]` → `pg_dump -Fc` cifrado con la clave
  pública (`.dump.age`, nunca en claro en disco) y su `.sha256`. En producción sin destinatarios no respalda.
  Con `BACKUP_KEEP_LAST=14 BACKUP_KEEP_WEEKS=8` borra de ese directorio los respaldos fuera de la retención.
- `DATABASE_URL=… AGE_IDENTITY_FILE=clave.txt pnpm db:restore-check [respaldo.dump.age]` → comprueba el sha256,
  descifra en un temporal, restaura en una base temporal nueva, compara filas por tabla y borra solo esa base
  temporal. Nunca escribe en la base de origen.

## Claves
- `age-keygen -o clave.txt` en el equipo de quien restaura (fuera del servidor). Al servidor solo va la línea
  `age1…` (pública). Recomendado: dos destinatarios (propietario + copia offline de la clave en papel/USB).
- Perder todas las claves privadas = respaldos ilegibles. Rotar: añadir el nuevo destinatario, esperar a que la
  retención renueve todas las copias, retirar el viejo.

## Rutina
- Diario: respaldo cifrado y copia a un proveedor distinto del de la base. **Pendiente de infraestructura**: el
  destino (bucket) y las claves los define el propietario.
- Semanal: `db:restore-check` sobre el último respaldo. Un respaldo que no se ha restaurado no cuenta.

## Restaurar tras una pérdida
1. Parar API y worker (evita escrituras sobre una base a medias).
2. Crear una base nueva y restaurar: `age -d -i clave.txt respaldo.dump.age | pg_restore --no-owner --dbname=<url nueva>`.
3. `pnpm db:migrate` (aplica las migraciones posteriores al respaldo, si las hay).
4. Apuntar `DATABASE_URL` a la base nueva y arrancar. La base dañada no se borra hasta cerrar el incidente.

## Qué no está en la base
- Media (fotos y vídeos) vive en el almacenamiento de objetos: se respalda con el versionado del bucket.
- Las claves (`FIELD_KEYS`, `AUTH_JWT_SECRET`) viven en el gestor de secretos: sin `FIELD_KEYS` las ubicaciones
  cifradas del respaldo no se pueden leer (es intencional).
