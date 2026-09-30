# ADR 0215 — Un evento en seguimiento vuelve a activo con actividad nueva

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.7 y §10.1 describen el ciclo de vida por inactividad del Event Engine: ACTIVE → MONITORING → RESOLVED. El ciclo
automático solo avanzaba. Un evento en seguimiento que volvía a recibir reportes o actualizaciones de fuentes seguía
mostrándose "en seguimiento", y solo moderación podía reactivarlo (ADR 0053). Además, la inactividad usaba la
ventana del catálogo base e ignoraba los ajustes por país que sí usan la deduplicación y la verificación.

## Decisión

- En `recomputeAggregates`, si el evento está en MONITORING y la evidencia nueva se observó después de su última
  actividad, vuelve a ACTIVE. Se registra `STATUS_CHANGED {from: MONITORING, to: ACTIVE, cause: NEW_ACTIVITY}` en la
  timeline y se publica `EventLifecycleChanged`, así alertas, feed y prioridades reevalúan.
- No reactivan el evento un reporte tardío (observado antes de la última actividad) ni un recálculo por moderación.
- Un evento RESOLVED no se reabre solo: la deduplicación no le suma evidencia, y reabrirlo sigue siendo manual
  (ADR 0053).
- `applyLifecycle` calcula las ventanas por categoría y país con `ref.category(code, country)`.

## Consecuencias

- El estado refleja la actividad real sin intervención manual.
- Prueba en `reports-events.test.ts`: el evento pasa a seguimiento, llega un reporte nuevo y vuelve a activo con su
  entrada en la timeline.
