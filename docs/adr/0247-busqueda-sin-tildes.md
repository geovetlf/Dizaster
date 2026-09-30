# ADR 0247 — Búsqueda de eventos sin distinguir tildes ni ñ

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

La búsqueda de eventos (ADR 0065) normaliza cada palabra con `searchKey` (sin tildes), pero comparaba contra
`lower(título)`, que las conserva. "Cañete" o "canete" nunca encontraban un título con "Cañete" (§6.3, §5.15).

## Decisión

- Migración 0098: `platform.search_key(text)`, la misma normalización que `searchKey` (minúsculas, sin tildes, ñ → n,
  sin signos). La búsqueda compara el título normalizado.
- Sin extensión `unaccent` ni servicio externo.

## Consecuencias

- Buscar con o sin tildes da lo mismo. Prueba en `search-accents.test.ts`.
