# ADR 0124 — Ciclo de vida del evento en el orden del feed

Estado: aceptada (2026-09-29)

## Contexto
§6.2 lista a Social como consumidor de `EventLifecycleChanged` y §5.3 pide ordenar por relevancia. La proyección
`social.event_signals` solo guardaba severidad y estado público: los posts de un evento RESOLVED o ARCHIVED seguían
recibiendo la ventaja de verificación y severidad como si el evento siguiera en curso.

## Decisión
- Migración 0053: `social.event_signals.lifecycle` (ACTIVE, MONITORING, RESOLVED, ARCHIVED), rellenada desde los
  eventos existentes. Feed consume `EventLifecycleChanged` y la actualiza.
- `RANK_BOOST_HOURS.lifecycle`: ACTIVE 0, MONITORING −2 h, RESOLVED −8 h, ARCHIVED −24 h. Mismo criterio que el
  resto de señales: suma acotada en horas, sin ML; nada se oculta, solo cede el sitio a lo que está pasando.
  NO AI REQUIRED; costo 0 (una columna de la proyección ya leída).
