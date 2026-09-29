# ADR 0107 — Búsqueda de publicaciones por texto

Estado: aceptada (2026-09-29)

## Contexto
RF-02 incluye búsqueda en la red social. Ya se buscaban eventos, lugares, personas, negocios, etiquetas y
categorías, pero no el texto de las publicaciones.

## Decisión
- `GET /v1/search/posts?q=&cursor=&limit=` (`PostSearchQuery`: 3–80 caracteres, 1–30 por página). Reutiliza la
  consulta del feed con un filtro `text`: mismas reglas (públicas, visibles, bloqueos, negocio activo, retraso de
  publicación, borrados), orden por recientes y el mismo cursor opaco. Sin ventana de 30 días.
- `lower(p.text) LIKE '%…%'` con `%`, `_` y `\` escapados; migración 0045 añade el índice GIN trigram parcial
  `posts_text_trgm_idx`. Sin IA ni motor de búsqueda externo (coste cero). NO AI REQUIRED.
- Las publicaciones seudónimas aparecen como en el feed, sin autor.
- App: sección "Publicaciones" en Buscar a partir de 3 letras, con `postSnippet` (una línea centrada en lo
  buscado) y enlace a la publicación.

## Consecuencias
- No distingue mayúsculas pero sí acentos (no se instala `unaccent`): "cafe" no encuentra "café". Se puede
  añadir más adelante con una columna normalizada si hace falta.
