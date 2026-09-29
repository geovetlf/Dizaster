# ADR 0117 — Fuentes oficiales y externas por separado en la ficha

Estado: aceptada (2026-09-29)

## Decisión
§10.1 pide "12 reportes ciudadanos · 2 fuentes externas · 1 fuente oficial". `event.events.official_source_count`
(migración 0049, con relleno desde la evidencia activa) se recalcula junto con los demás agregados; `EventSummary`
añade `officialSourceCount` y `sourceCount` sigue siendo el total no ciudadano (compatible con versiones anteriores).
La app arma la cabecera con `evidenceCounts`: reportes, externas (total − oficiales) y oficiales, ocultando las que
valen cero, en los cuatro idiomas. NO AI REQUIRED.
