# ADR 0241 — Un aviso oficial ya vencido no suena ni abre eventos

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

ADR 0174 dice que lo vencido antes de salir no suena. Pero si la fuente traía un `expires` ya pasado, la alerta
recibía el plazo por defecto de 24 h y salía como push (crítica si era grave). Pasaba tras una caída, al activar un
feed o con feeds que listan avisos viejos. Además, ese ítem vencido abría un evento nuevo en el mapa.

## Decisión

- La alerta usa el vencimiento de la fuente tal cual, aunque ya haya pasado; el plazo por defecto solo se usa si la
  fuente no trae ninguno. El envío la marca EXPIRED: queda en el historial y no suena.
- Un ítem cuyo `endsAt` ya pasó no crea eventos. Si coincide con un evento existente, sí se suma como evidencia.

## Consecuencias

- Ninguna alerta vieja despierta a nadie. Pruebas en `alert-cap-fields.test.ts` y `source-end.test.ts`.
