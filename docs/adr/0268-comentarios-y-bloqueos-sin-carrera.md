# ADR 0268 — Comentarios, bloqueos y compartidos en transacción, sin carrera en los cupos

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §4.2 (consistencia), §7.3; ADR 0045, 0155, 0178, 0208, 0252
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La auditoría del 2026-09-30 encontró que `addComment`, `setBlock`/`setBlockByHandle`, `deleteComment` y
`recordExternalShare` corrían sentencia a sentencia sobre el pool. Dos envíos simultáneos de la misma persona podían
leer el mismo conteo y superar juntos el cupo de comentarios por minuto o el tope de bloqueos (ADR 0208); y un fallo a
mitad dejaba estados parciales (comentario sin su detección de datos personales, borrado sin limpiar reacciones,
compartido sin contador).

## Decisión

- Las cinco rutas corren en `withTransaction`.
- `addComment` toma `pg_advisory_xact_lock` por persona (`social.comment:<perfil>`) antes de mirar el reintento y el
  cupo; los bloqueos, uno por persona (`social.block:<perfil>`) antes de comprobar el tope. El candado es por persona:
  nadie espera por lo que hace otra.
- Se añadió `test/social-concurrency.test.ts`: cupo + 5 comentarios simultáneos dejan exactamente el cupo; tres envíos
  a la vez con el mismo `clientId` crean uno; con un solo hueco, de dos bloqueos simultáneos pasa uno. Sin los
  candados, las dos primeras comprobaciones fallan (verificado).

## Consecuencias

- Un segundo comentario simultáneo de la misma persona espera unos milisegundos al primero.
