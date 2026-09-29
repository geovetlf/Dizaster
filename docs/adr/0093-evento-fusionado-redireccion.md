# ADR 0093 — Redirección de un EVENT fusionado y de sus seguidores

- Estado: aceptada (2026-09-29).
- Blueprint: §5.7, §6.2 ("redirecciones de ids"), ADR 0034
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Al fusionar un duplicado en otro EVENT (ADR 0034), sus posts y reportes pasan al destino. Pero la app seguía
mostrando el duplicado al abrir un enlace `/e/<id>`, un aviso antiguo o un evento seguido, y quien seguía el
duplicado dejaba de recibir avisos, porque los avisos buscan seguidores del evento destino.

## Decisión

- La app, al abrir un evento con `mergedIntoId`, reemplaza la pantalla por la del destino. Sigue cadenas de
  fusiones hasta 5 saltos; más saltos indican un dato roto y se muestra el evento tal cual.
- `GET /v1/events/:id` ya devolvía `mergedIntoId`; el contrato lo nombra como `EventDetail`.
- Al recibir `EventMerged`, quien seguía el duplicado pasa a seguir también el destino. Esa fila guarda
  `via_merge` = el duplicado (migración 0043).
- El seguimiento original del duplicado no se borra. Al revertir la fusión basta con quitar las filas con
  `via_merge`, y todo vuelve a como estaba.
- Si la persona sigue el destino a mano después de la fusión, `via_merge` se limpia y ese seguimiento se conserva
  aunque se revierta.

## Consecuencias

- Los enlaces, avisos y listas antiguas siempre llevan al evento vivo.
- Los avisos de actualización del destino llegan a quien seguía cualquiera de los eventos fusionados.
- Pruebas: `services/core/test/merge-follows.test.ts`, `apps/mobile/test/merged-event.test.ts`.
