# ADR 0175 — Ciudad del evento

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

El modelo del Blueprint (§7, Event y Location) incluye `city_id`. El lugar contextual (`event.events.place`, ADR 0016)
ya calculaba la ciudad desde el punto público generalizado (nivel `cityLevel` del país o el lugar poblado más
cercano), pero no había columna: seguir una ciudad (en Perú, una provincia) no avisaba ni llenaba "Siguiendo".

## Decisión

- Migración 0082: `event.events.city_id` como columna generada desde `place->'city'->>'id'`, con índice parcial.
  Toda escritura de `place` (crear, recalcular, dividir) la mantiene sin cambiar ese código.
- `alertSnapshot` y `publicStates` la devuelven. El Alert Engine la suma a los lugares del evento: quien sigue la
  ciudad recibe el aviso como `FOLLOWED_PLACE`. La búsqueda de eventos por nombre de lugar también la usa.
- `social.event_signals.city_id` (rellenada desde los eventos existentes) para el feed "Siguiendo" por lugar.

## Consecuencias

- La ciudad sale del punto público, nunca del punto del reportero; en categorías sensibles puede no haberla.
- Una ciudad que es un lugar poblado (no un área administrativa) queda guardada, pero hoy solo se pueden seguir áreas.
