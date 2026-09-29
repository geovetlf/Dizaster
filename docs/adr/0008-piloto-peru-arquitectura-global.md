# ADR 0008 — Perú como piloto, arquitectura global

- Estado: Aceptado · Fecha: 2026-09-29

## Decisión
- Nada del código conoce a Perú. Todo lo específico es **dato versionado**: `data/countries/country-config.json` (estado PILOT, locale, zona horaria), `data/categories/categories.json` (nombres regionales como "Huaico", "Heladas y friaje"), `data/emergency-numbers/`, `data/source-registry/` (IGP, INDECI, SENAMHI en estado RESEARCH).
- Los tests prueban el mismo flujo con Perú, Chile, Colombia, España y Japón.
- Los números de emergencia están marcados `NEEDS_VERIFICATION` y la app lo advierte: contrastarlos con la fuente oficial es condición de lanzamiento por país.
