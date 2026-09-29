# ADR 0053 — Cambio manual del ciclo de vida de un evento

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.7 (estados ACTIVE, MONITORING, RESOLVED, ARCHIVED), §5.21

## Decisión
- `POST /v1/moderation/events/:id/status {to, reason}` (solo moderación) lleva un evento a cualquiera de los cuatro
  estados: cerrar antes uno que terminó, archivar uno que no aporta o reactivar uno cerrado por inactividad.
- Siempre con motivo. Queda en `event.status_log` (quién, cuándo, de qué a qué, por qué). La línea de tiempo pública
  dice solo `STATUS_CHANGED` con `cause: "MODERATION"`: nunca quién lo hizo.
- Reactivar (`ACTIVE`) reinicia `last_activity_at`; si no, el ciclo automático por inactividad lo cerraría enseguida.
- Un evento fusionado no se toca (409): se gestiona desde el que lo absorbió. Pedir el estado actual también es 409.
- Publica `EventLifecycleChanged` (ahora admite `ARCHIVED`), así que Alert reevalúa como con el ciclo automático.
- La app muestra el estado actual, los cambios recientes y botones por estado en la pantalla de herramientas de
  evento; exigen el mismo motivo que fusionar o separar.

## Fuera de alcance
- Revertir un cambio de estado es aplicar el cambio contrario con motivo; no hace falta una acción aparte.
