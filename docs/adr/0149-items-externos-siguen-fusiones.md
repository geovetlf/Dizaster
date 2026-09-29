# ADR 0149 — Los ítems externos siguen fusiones, reversiones y divisiones

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno

## Contexto

§6.2 pide que quienes guardan ids de eventos sigan `EventMerged` / `EventSplit`. Los reportes ya lo hacían (ADR
0034); `ingestion.external_items.event_id` no. Efecto visible: una institución que confirmó el evento A podía
desmentir el evento B después de fusionar A en B, y B quedaba confirmado y desmentido a la vez (ADR 0095).

## Decisión

- `IngestionService.registerHandlers`: `EventMerged` mueve los ítems del absorbido al destino; `EventMergeReverted` y
  `EventSplit` mueven los ítems cuya evidencia se movió. Mismo patrón que `report.follow-*`.
- Con eso, la regla "una declaración por institución y evento" vuelve a cumplirse tras una fusión (test).
