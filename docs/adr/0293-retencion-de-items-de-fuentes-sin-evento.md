# ADR 0293 — Retención de ítems de fuentes sin evento

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §7.4 (ingesta), §12 (cost-first); ADR 0075, 0155, 0248
- IA: no. Costo: 0.

## Contexto

La retención diaria ya borra el crudo de las fuentes (ADR 0075) y las corridas de más de 90 días (ADR 0248), pero
nunca borraba filas de `ingestion.external_items`. Cada sismo, incendio o boletín que una fuente publica queda como fila
para siempre, aunque no haya llegado a ningún evento (sin punto, sin coincidencia o con error).

## Decisión

1. La tarea diaria `retention.source-items` borra los ítems en `IGNORED` o `ERROR`, sin `event_id`, con `fetched_at`
   de más de `RUNS_RETENTION_DAYS` (90 días, el mismo plazo de las corridas).
2. Los ítems ligados a un evento (`MAPPED`) se quedan: son la evidencia que lo respalda y la fuente que se muestra.
   Tampoco se tocan los `NEW` (en proceso).
3. Borra en lotes de 500 con el mismo tope de tiempo que la retención del crudo.
4. Son datos técnicos de fuentes públicas, no datos personales. Si una fuente vuelve a publicar un ítem borrado, entra
   de nuevo como ítem nuevo.
