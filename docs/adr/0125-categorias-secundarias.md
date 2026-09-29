# ADR 0125 — Categorías secundarias del evento

Estado: aceptada (2026-09-29)

## Contexto
§7.3 define `Event.secondary_categories[]`. La deduplicación ya une reportes de categorías compatibles
(`accident.traffic` ↔ `infra.road_blocked`, §8.4), pero el evento solo conservaba la categoría del primero: quien
filtraba o buscaba "vía bloqueada" no encontraba un choque que corta la vía.

## Decisión
- Migración 0054: `event.evidence.category_code` (rellenada desde reportes y elementos externos) y
  `event.events.secondary_categories` con índice GIN.
- Las secundarias se **recalculan** en `recomputeAggregates` desde las evidencias activas que afirman el hecho
  (distintas de la principal), no se acumulan: fusiones, reversiones, divisiones y retiros las dejan al día.
- `EventSummary.secondaryCategories`. El filtro de categorías del mapa (y sus teselas) y la búsqueda de eventos
  también encuentran el evento por ellas. La principal no cambia: sigue mandando en icono, sensibilidad y reglas.
- App: línea "También: …" en la ficha del evento. NO AI REQUIRED; costo 0.

## Consecuencias
- Alertas por categoría siguen usando la principal (evita avisos duplicados); ampliar a secundarias sería otra
  decisión.
