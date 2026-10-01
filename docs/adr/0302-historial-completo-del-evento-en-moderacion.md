# ADR 0302 — Historial completo del evento en moderación, a pedido y con totales

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §7.3 (línea de tiempo y notas), §13.1 (auditoría de moderación); ADR 0053, 0147, 0160, 0179
- IA: no. Costo: 0.

## Contexto

`GET /v1/moderation/events/:id` devolvía solo una parte de cada historial:

| Historial | Tope |
| --- | --- |
| Cambios de estado | 20 |
| Cambios de gravedad | 20 |
| Cambios de sensibilidad | 20 |
| Fusiones | 50 |
| Notas de moderación | 100 |
| Evidencias activas | 500 |

Nada indicaba que faltaran entradas. En un evento largo, moderación podía decidir sin ver los primeros cambios ni las
notas más antiguas, aunque siguieran en la base.

## Decisión

1. El detalle incluye `historyTotals`, el total real de cada historial.
2. `?history=full` sube el tope de cada historial a `MODERATOR_HISTORY_FULL_LIMIT`, que vale 500. Por defecto
   (`recent`) se mantienen los topes de siempre, para que la pantalla cargue rápido.
3. Los historiales se ordenan con `id` como desempate, para que el orden sea estable.
4. La app muestra "Ver todo el historial" solo cuando algún total es mayor que lo recibido. El modo completo se
   mantiene al recargar después de una acción.
5. No cambia quién ve el detalle. Solo verificación y moderación lo ven, siempre con `no-store`.

## Consecuencias

- Moderación sabe cuándo hay más historial y puede verlo sin salir de la app.
- Por encima de 500 entradas en un mismo historial, el total sigue a la vista. Si hiciera falta, se paginaría con
  otro ADR.
- Pruebas:
  - `services/core/test/event-history-full.test.ts`: lo reciente, el total, el modo completo, un valor inválido y
    el 403;
  - `apps/mobile/test/moderation-logic.test.ts`: `historyTruncated`.
