# ADR 0048 — Cifrado por columna de la ubicación precisa

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §13.1 ("cifrado a nivel de columna para la ubicación precisa del
  reportante, con claves gestionadas fuera de la base de datos")

## Decisión
- El fix preciso del dispositivo (`report.presence_evidence`) se guarda en `device_fix_enc` con AES-256-GCM en la
  aplicación. La clave vive en `FIELD_KEYS` (entorno o gestor de secretos), nunca en la base de datos. Producción no
  arranca sin ella.
- El id del reporte va como dato autenticado: un valor copiado a otra fila no se descifra.
- Rotación: varias claves con id; se cifra con la primera y se descifra con cualquiera. Como la presencia precisa se
  borra a los 30 días, la clave anterior solo hace falta ese tiempo.
- Solo se descifra para exportar los datos de la propia persona. El cálculo de presencia usa el fix en memoria al
  recibir el reporte; después solo quedan la celda H3 r7 y la distancia al pin.
- Filas anteriores: el worker diario las cifra y vacía la columna en claro (`encryptLegacyFixes`).
- Sin gasto: `node:crypto`, sin KMS. Un KMS gestionado es una mejora posible cuando exista cuenta cloud.

## Fuera de alcance
- El pin del reporte no se cifra: lo necesitan las consultas espaciales (deduplicación, eventos cercanos). Ya se
  acota a un radio de la presencia y nunca sale sin generalizar por la API pública.
- Zonas guardadas y última ubicación ya se guardan como celdas H3 (≈0,7 y ≈5 km²), no como puntos precisos.
