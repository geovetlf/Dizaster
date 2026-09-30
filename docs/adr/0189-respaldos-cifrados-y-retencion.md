# ADR 0189 — Respaldos cifrados con clave pública y retención

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (age es software libre)

## Contexto

§13.1: respaldos diarios cifrados, fuera del proveedor de la base, con retención. ADR 0070 dejó el cifrado como
paso manual del operador y sin retención: un respaldo en claro con ubicaciones cifradas por columna, cuentas y
moderación seguía siendo un riesgo, y los respaldos crecían sin límite.

## Decisión

- Cifrado con **age** (clave pública X25519): `BACKUP_AGE_RECIPIENTS` lista claves `age1…`. `pg_dump` va por tubería
  a `age`: el volcado no toca el disco en claro y el servidor no tiene con qué descifrarlo (la clave privada la
  guarda quien restaura). Archivo parcial se borra si algo falla.
- En producción (`NODE_ENV=production`) o con `BACKUP_REQUIRE_ENCRYPTION=1`, sin destinatarios **no se respalda**
  (sale con código 3): mejor un fallo visible que un respaldo en claro.
- `db-restore-check` comprueba el `.sha256`, descifra con `AGE_IDENTITY_FILE` a un temporal y restaura como antes.
- Retención (`scripts/backup-retention.mjs`, opcional con `BACKUP_KEEP_LAST`): últimos N más el más reciente de
  cada una de las últimas `BACKUP_KEEP_WEEKS` semanas (contando la actual). Solo borra archivos con el nombre exacto
  de `db-backup.sh`, en ese directorio, y nunca el más reciente.

## Consecuencias

- Las claves y el destino fuera del proveedor siguen siendo del propietario (runbook `respaldo-y-restauracion.md`).
- Probado de punta a punta en desarrollo (respaldar cifrado → verificar sha256 → descifrar → restaurar) y la
  retención en `services/core/test/backup-retention.test.ts`.
