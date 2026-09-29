# ADR 0034 — Fusión y división manual de EVENTs por moderación

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.7, §5.21, §6.1 (`merge`, `split`), §6.4, principio 4

## Contexto
La deduplicación automática (ADR 0030) deja casos ambiguos, y a veces une dos sucesos distintos. El modelo
tenía `merged_into_id` y `merge_log`, pero no había forma de fusionar, revertir ni dividir.

## Decisión
- **Fusionar** (`POST /v1/moderation/events/:id/merge`, hasta 10 duplicados, motivo obligatorio): las evidencias
  activas y las fotos (`MEDIA_ADDED`) del duplicado pasan al destino; el duplicado queda con `merged_into_id` (la
  API pública lo devuelve para redirigir); huella, geometría y contadores del destino se recalculan.
  `merge_log` guarda las evidencias movidas, el actor y el motivo.
- **Revertir** (`POST /v1/moderation/merges/:id/revert`, motivo obligatorio): vuelven las evidencias movidas que
  sigan en el destino y el duplicado reaparece. No se revierte dos veces.
- **Dividir** (`POST /v1/moderation/events/:id/split`): las evidencias elegidas forman un evento nuevo de la misma
  categoría; el original debe conservar al menos una. Se registra en `event.split_log`.
- Consumidores: `EventMerged`, `EventMergeReverted` y `EventSplit` redirigen reportes (`report.reports.event_id`)
  y posts (`social.post_event_links`, con `via_merge` para poder revertir). Para verificación, alertas, feed y
  reputación, cada operación equivale a evidencia nueva en los eventos afectados (`EventEvidenceAdded`); la
  división publica además `EventCreated` para el evento nuevo.
- La vista de moderación (`GET /v1/moderation/events/:id`) lista evidencias **sin identidad de quien reportó**.
  La timeline pública no expone marcas internas (`reportId`, `viaMerge`).
- App: pantalla "Fusionar o dividir" desde un caso de EVENT, con duplicados cercanos, selección de evidencias y
  reversión de fusiones.

## Consecuencias
- La severidad del destino no baja al revertir (se toma el máximo); un moderador puede ajustarla por otras vías.
- Las fotos de reportes anteriores a esta versión no tienen `reportId` y se quedan en el evento original al dividir.
- Personas ya avisadas por el evento original pueden recibir el aviso del evento nuevo tras una división.
