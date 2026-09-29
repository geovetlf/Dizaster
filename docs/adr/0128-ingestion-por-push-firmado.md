# ADR 0128 — Ingestión por push firmado por fuente

Estado: aceptada (2026-09-29)

## Contexto
§9.2 lista "webhooks / feeds push" entre los modos de ingestión. Hasta ahora todo era sondeo (carriles NORMAL y
URGENT, ADR 0010/0011). Una fuente que puede avisar al publicar ahorra latencia en lo urgente y peticiones de sondeo.
Ninguna fuente real está acordada todavía: se deja listo el mecanismo, sin activar nada.

## Decisión
- `POST /v1/ingest/:sourceKey/push`: la fuente envía el mismo documento que publica en su feed (el adapter es el
  mismo que en el sondeo), con cuerpo crudo de hasta 2 MB.
- Firma por fuente: `x-dizaster-timestamp` (segundos Unix) y `x-dizaster-signature: sha256=<hex>` =
  HMAC-SHA256(secreto, `"<timestamp>.<cuerpo>"`), comparada en tiempo constante. Se acepta ±5 min (anti-repetición);
  los ítems repetidos son duplicados idempotentes como en el sondeo.
- El secreto vive solo en el entorno (`SOURCE_PUSH_SECRET_<CLAVE>`), igual que las claves de fuente (ADR 0067);
  nunca en `data/`. La fuente además debe estar ACTIVE y tener `config.push: true`.
- "No existe", "no acepta push" y "sin secreto" responden el mismo 404: no se revela qué fuentes hay. Firma o marca
  de tiempo inválidas → 401; documento que el adapter no puede interpretar → 422 y corrida FAILED.
- Cada push queda en `ingestion.runs` con `trigger = 'PUSH'` (migración 0055), carril URGENT, con el crudo archivado
  (ADR 0075). Todo el documento se ingiere; lo urgente según el adapter o la regla de promoción (ADR 0100).
- El límite general por IP de la API aplica también aquí. NO AI REQUIRED; costo cero.

## Pendiente (propietario)
Acordar con cada fuente que ofrezca push el secreto compartido y el formato. Ninguna fuente tiene `push: true` hoy.
