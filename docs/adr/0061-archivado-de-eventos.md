# ADR 0061 — Archivado de eventos

- Estado: Aceptado · Fecha: 2026-09-29 · Decisión del propietario D-ARCHIVE · Blueprint §5.7

## Decisión
- Un evento RESOLVED sigue en el mapa operativo (más tenue) durante `EVENT_ARCHIVE_AFTER_DAYS` (7 por defecto,
  configurable). Después, el worker lo pasa a ARCHIVED. Antes de este ADR, RESOLVED salía del mapa enseguida.
- `resolved_at` lo mantiene un trigger de la tabla, para cubrir todas las rutas que resuelven (inactividad,
  moderación, fin de la fuente). Reactivar lo limpia.
- Archivar no borra nada: reportes, fuentes, historial, verificación y trazabilidad quedan. El evento sigue
  accesible por enlace (`GET /v1/events/:id`, su timeline y su feed) y para análisis histórico. Sale del mapa y de los
  candidatos de deduplicación. Moderación puede reactivarlo (ADR 0053).
- Timeline: `STATUS_CHANGED` con causa `ARCHIVE_AFTER_RESOLVED`. Publica `EventLifecycleChanged`. El motor de avisos
  lo evalúa, pero archivar no genera push.
- AI_REQUIRED = NO · EXTERNAL_API_REQUIRED = NO · COST = ZERO.
