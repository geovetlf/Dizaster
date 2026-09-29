# ADR 0133 — Re-procesar el crudo guardado de las fuentes

Estado: aceptada (2026-09-29)

## Contexto
§7.3 (ExternalItem): "se guarda el crudo para auditoría y re-procesamiento". Desde el ADR 0075 el crudo se guarda,
pero tras corregir un adapter o un mapa de categorías (ADR 0122) había que esperar a que la fuente volviera a
publicar cada ítem.

## Decisión
- `IngestionScheduler.reprocess(clave, {desde, hasta})` y el comando `pnpm reprocess-source <clave> [desde] [hasta]`:
  lee los crudos del rango en orden de llegada con la configuración actual, se queda con la última versión de cada
  ítem (nunca se reescribe un ítem con un documento más viejo) y la ingiere una vez por el carril NORMAL.
- Idempotente: lo que no cambió es un duplicado sin efecto; lo que cambió actualiza el ítem y vuelve a resolver su
  evento como cualquier actualización de la fuente. No re-aplica retiros. Solo fuentes ACTIVE.
- Queda como corrida `trigger = 'REPROCESS'` (migración 0058). Runbook "fuente caída o con datos erróneos".
- Corrección encontrada al probarlo: GDACS y Copernicus EMS usaban "ahora" como fecha de un ítem sin fechas, lo que
  lo hacía distinto en cada lectura (se re-ingería en cada sondeo). Ahora esos ítems se descartan.
- NO AI REQUIRED; costo cero (lee el almacenamiento propio, no consulta la fuente).
