# ADR 0242 — Coordenadas fuera de rango en las fuentes

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Los adaptadores USGS y GDACS solo comprobaban que la coordenada fuera un número. Un punto fuera de rango hacía
fallar PostGIS o H3 con un error que no es de dominio: toda la corrida URGENT quedaba FAILED y, tras tres fallos, el
cortacircuitos pausaba la fuente (§9.2: la vía urgente nunca cae en silencio).

## Decisión

- `validLatLng` (finita, |lat| ≤ 90, |lng| ≤ 180) en los adaptadores USGS y GDACS: el ítem malo se salta, como ya
  hacían EMSC, FIRMS, CAP y Copernicus.
- Defensa general en `ingest`: un punto imposible de cualquier adaptador es un `DomainError` de validación, así que
  ese ítem queda en ERROR (ADR 0155) y el resto de la corrida sigue.

## Consecuencias

- Un dato malo de una fuente no apaga la vía urgente. Prueba en `adapter-coordinates.test.ts`.
