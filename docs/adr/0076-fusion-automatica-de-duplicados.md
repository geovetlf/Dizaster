# ADR 0076 — Fusión automática de duplicados, cola de posibles duplicados y métricas de reversión

- Estado: aceptada (2026-09-29)
- Blueprint: §5.7 ("fusión/división manual por moderadores y automática con umbrales"), §8.4 (bandas y métricas)
- IA: **NO AI REQUIRED**. Costo: una pasada por hora sobre los EVENTs con actividad en las últimas 24 h (≤ 200).

## Contexto

La deduplicación en línea decide al llegar cada reporte o ítem. Aun así quedan EVENTs duplicados: el punto medio
se movió después, llegaron por fuentes distintas o en zonas vecinas casi a la vez. Hasta ahora solo moderación podía
fusionarlos (ADR 0034) y no había cola ni medida de cuántas fusiones automáticas eran erróneas.

## Decisión

- `EventService.sweepDuplicates` (worker, cada hora) aplica a cada EVENT activo reciente las **mismas** reglas que
  al adjuntar un reporte (`decideDedup`, `dedup-2`, radio y ventana de su categoría):
  - `match ≥ 0,80` con un único candidato claro → fusión automática con `merge()` existente, actor
    `RULE:auto-merge` y la puntuación en `merge_log.score`. Reversible con la ruta de moderación de siempre.
  - Franja ambigua (`0,55–0,80` o varios candidatos cercanos) → par a `event.duplicate_candidates` (`AMBIGUOUS_SCORE`).
  - Si los dos eventos tienen evidencia externa u oficial, nunca se fusionan solos (la fuente los publicó como
    ítems distintos) → cola con `BOTH_SOURCED`.
- Destino de la fusión: el de mayor nivel de verificación, luego el que tiene fuentes, luego el más antiguo.
- Un par cuya fusión se revirtió, o que moderación descartó, no se vuelve a proponer.
- Moderación: `GET /v1/moderation/duplicates` (pares abiertos con ambos eventos), `POST
  /v1/moderation/duplicates/:id/dismiss` (con motivo). Fusionar un par con la ruta de fusión lo cierra como `MERGED`.
- Métricas en el informe de calidad: `autoMerged`, `autoMergeReverted`, `autoMergeRevertRate`, `duplicatesOpen`.
  Una tasa de reversión alta es la señal para subir los umbrales en una nueva versión de reglas.

## Consecuencias

- Menos duplicados en el mapa sin trabajo humano, con cada fusión explicable y reversible.
- La IA como desempate de la franja ambigua (§8.4 paso 3.2) sigue sin integrar: la cola la resuelve moderación.
- Pruebas: `services/core/test/auto-merge.test.ts`.
