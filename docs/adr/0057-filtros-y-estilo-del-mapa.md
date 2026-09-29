# ADR 0057 — Filtros del mapa y estilo por verificación

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §11.4, §5.6

## Decisión
- `GET /v1/events` acepta `verified=1`: solo eventos con nivel distinto de UNVERIFIED y sin disputa. `categories`
  (ya existente, raíz o hoja) queda limitado a 20 valores. Sin filtros la URL es la misma de antes (mejor cache CDN).
- El mapa tiene una fila de chips arriba: "Solo verificados" y las categorías raíz del catálogo (las mismas del
  inicio). Cambiar el filtro recarga el área visible.
- Estilo de cada punto: el relleno sigue siendo la categoría, y el borde indica el estado público: verde grueso =
  confirmado oficialmente, azul/morado = corroborado, gris fino y algo transparente = sin verificar, naranja tenue =
  en disputa. Los clusters no cambian.
- Los eventos FALSE y los resueltos siguen fuera del mapa, como antes.
