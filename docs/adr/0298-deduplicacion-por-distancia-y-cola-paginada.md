# ADR 0298 — Candidatos de deduplicación por distancia y cola de duplicados por páginas

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §8.4 (deduplicación), §13.1 (moderación); ADR 0034, 0076, 0096, 0230
- IA: no. Costo: 0.

## Contexto

1. Al unir un reporte a un evento, la consulta de candidatos traía hasta 50 eventos cercanos sin orden, y la pregunta
   "¿es este?" hasta 40, también sin orden; la puntuación se calculaba después. Con más eventos cercanos que el tope, el
   más parecido podía quedar fuera y el reporte crear un evento duplicado.
2. La cola de posibles duplicados devolvía los 50 pares más antiguos y la pestaña mostraba "(50)" aunque hubiera más.

## Decisión

1. Ambas consultas ordenan en SQL por distancia al punto (la ubicación interna para unir reportes, la pública para
   "¿es este?", como fija ADR 0230), luego por actividad más reciente y por id. El tope no cambia.
2. `GET /v1/moderation/duplicates` acepta `cursor` y `limit` (1–200, 50 por defecto), pagina por `(created_at, id)`
   ascendente y devuelve `nextCursor` y `total` (pares abiertos en toda la cola). Un cursor desconocido da `VALIDATION`.
   Descartar o fusionar un par no rompe el cursor: se compara con la fila del cursor sea cual sea su estado.
3. La app carga más pares al llegar al final de la lista y la pestaña muestra el total real.
