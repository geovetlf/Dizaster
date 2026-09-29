# ADR 0077 — Ubicar ítems de fuentes sin coordenadas por geocódigo exacto

- Estado: aceptada (2026-09-29)
- Blueprint: §9.4 punto 3 ("si solo trae un lugar, se resuelve contra la base local; si no, queda sin mapa")
- IA: **NO AI REQUIRED**. Costo: 0 (una consulta PostGIS por ítem nuevo sin coordenadas; ninguna API de geocodificación).

## Contexto

Muchas alertas oficiales (CAP de servicios meteorológicos y de protección civil, entre ellas las que se esperan de
SENAMHI e INDECI) describen el área con códigos oficiales (`<geocode>` UBIGEO, ISO 3166-2) y sin polígono. Hasta
ahora esos ítems quedaban `IGNORED` y no llegaban al mapa.

## Decisión

- El adapter CAP conserva los `<geocode>` de las áreas cuando no hay polígono ni círculo (`NormalizedItem.geocodes`).
- `GeoService.locateGeocodes` busca **coincidencias exactas** en el índice administrativo local (ADR 0016) según
  `data/geo/geocode-schemes.json` (dato, no código): UBIGEO → `PE:<código>` (departamento, provincia o distrito);
  ISO 3166-2 → `admin_areas.code`. Cada esquema valida el formato con un patrón.
- Punto: `ST_PointOnSurface` de la unión de las áreas (siempre dentro de un área, a diferencia del centroide).
  Incertidumbre: distancia del punto a la esquina más lejana de la caja de las áreas, así cubre toda la zona.
- El ítem guarda `raw.locatedBy = "GEOCODE"` y los ids de área usados. El hash de duplicado se calcula sobre lo que
  mandó la fuente, así un ítem repetido no vuelve a consultar el índice.
- **No** se ubica por nombre de lugar (`areaDesc`): "Santa Rosa" o "San Juan" existen en decenas de sitios y un
  error pondría una alerta oficial en el lugar equivocado. Código desconocido o esquema no registrado → sin mapa.

## Consecuencias

- Las alertas regionales se ven en el mapa con una incertidumbre grande y honesta (toda la región).
- Para otro país basta agregar su esquema al JSON y sus límites al índice.
- Pruebas: `services/core/test/geocodes.test.ts` (adapter, ubigeo de distritos, ISO 3166-2, códigos desconocidos,
  mal formados o de otro esquema).
