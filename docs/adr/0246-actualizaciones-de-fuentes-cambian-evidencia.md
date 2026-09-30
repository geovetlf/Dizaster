# ADR 0246 — Las correcciones de una fuente cambian su evidencia

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Cuando un ítem externo ya visto volvía con cambios, su evidencia solo actualizaba la gravedad (ADR 0160). USGS retira
un sismo con el mismo id (`status: "deleted"`) y un CAP Update reutiliza el id del aviso original: esas retiradas,
cambios de zona u hora nunca llegaban a la verificación ni al mapa (§9.2 "actualizar si cambió", §10.2 DISPUTED).
La prueba de negación externa usaba otro id y lo ocultaba.

## Decisión

- Si la evidencia ya existe, se actualizan afirmación (OCCURRING / NOT_OCCURRING), punto y hora observada, y el
  área afectada si viene. Si algo cambió, se recalculan los agregados del evento y se publica
  `EventEvidenceAdded`, así la verificación y las alertas se reevalúan.
- El ítem guarda también su nueva afirmación y fecha de publicación.
- La prueba usa el mismo id, como hace USGS.

## Consecuencias

- Un sismo retirado por la fuente queda en disputa aunque llegue con el mismo id. Prueba en `external-denial.test.ts`.
