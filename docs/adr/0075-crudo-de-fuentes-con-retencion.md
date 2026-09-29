# ADR 0075 — Crudo de cada fuente para auditoría, con retención

- Estado: aceptada (2026-09-29)
- Blueprint: §7.3 (`ExternalItem.raw_ref`), §7.4 ("el crudo en object storage, no en la BD"), §9.3
- IA: **NO AI REQUIRED**. Costo: almacenamiento de objetos comprimidos; con las fuentes actuales, pocos MB por mes.

## Contexto

`external_items.raw_ref` existía desde la migración 0001 pero nunca se llenaba. Sin el crudo no se puede auditar
por qué una fuente oficial confirmó un evento ni re-procesar ítems cuando se corrige un adapter.

## Decisión

- En cada ejecución con respuesta 2xx, el planificador guarda el cuerpo tal cual, comprimido con gzip, en
  `sources/raw/<fuente>/<AAAA-MM-DD>/<run>.json.gz` del mismo almacenamiento de objetos, **antes** de interpretarlo.
- Una respuesta idéntica a la última guardada de la fuente (mismo SHA-256) no se vuelve a subir: se reutiliza la clave.
- `ingestion.runs.raw_ref/raw_sha256` y `external_items.raw_ref` apuntan al objeto (migración 0038).
- Las claves son privadas: el almacenamiento de desarrollo solo sirve `public/*` y en producción el bucket no
  expone `sources/`.
- Retención `SOURCE_RAW_RETENTION_DAYS` (30 por defecto, 0 = no guardar). El worker diario borra los objetos que
  ninguna ejecución usó en ese plazo y limpia las referencias.
- Un fallo del almacenamiento nunca frena la ingestión (alertas oficiales primero): el ítem entra sin crudo y se
  registra un aviso.

## Consecuencias

- Auditoría y re-procesamiento posibles durante 30 días sin crecer la base de datos.
- Pruebas: `services/core/test/source-raw.test.ts` (compresión, reutilización, privacidad, retención, fallo del
  almacenamiento, retención 0).
