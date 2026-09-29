# ADR 0078 — Consultas del mapa alineadas a teselas

- Estado: aceptada (2026-09-29)
- Blueprint: §11.4 ("respuestas cacheables en CDN por celda de consulta, zoom y filtro; muchos usuarios mirando la
  misma zona = una sola consulta a la base")
- IA: **NO AI REQUIRED**. Costo: baja la carga de la base y el cómputo a medida que crece el uso; 0 en desarrollo.

## Contexto

`GET /v1/events?bbox=…&zoom=…` recibe el bbox exacto de cada pantalla (5 decimales): dos personas mirando Lima
nunca piden la misma URL y la CDN no puede compartir nada. Además la vista previa del inicio mandaba en la URL un
bbox centrado en la ubicación de la persona.

## Decisión

- Nueva ruta `GET /v1/events/tiles/:z/:x/:y?categories=…&verified=1` con el esquema XYZ de MapLibre/OSM. Devuelve
  lo mismo que la consulta por bbox para los límites de la tesela, con `zoom = z` (mismas reglas de clusters H3).
  `cache-control: public, max-age=30, s-maxage=60, stale-while-revalidate=30`. Categorías normalizadas (sin
  repetidos, ordenadas).
- `@dizaster/geo-kit`: `tilesForView` (teselas que cubren la vista; si pasan de 12 baja un nivel de zoom; soporta el
  antimeridiano), `tileBounds`, `isValidTile` y `mergeMapTiles` (un evento sobre el borde de dos teselas cuenta una
  vez; un cluster H3 partido por un borde se suma).
- La app (mapa y vista previa del inicio) pide las teselas en paralelo **sin** cabecera `Authorization`: una
  petición autenticada no se guarda en una CDN compartida. La capa del mapa es pública, así que no pierde nada.
- `GET /v1/events?bbox` se mantiene por compatibilidad con versiones anteriores de la app.

## Consecuencias

- La misma zona produce las mismas URLs para todos: la CDN (D-18) puede absorber la mayor parte del tráfico del mapa.
- Privacidad: las URLs ya no llevan el bbox exacto alrededor de la persona, solo teselas.
- Pruebas: `packages/geo-kit/test/geo-kit.test.ts` (límites, estabilidad, tope, antimeridiano, unión) y
  `services/core/test/map-tiles.test.ts` (teselas unidas = bbox, clusters, filtros, teselas inválidas, cabeceras).
