# ADR 0220 — Alcance limitado para cuentas nuevas en "Para ti"

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.3 pide que las cuentas nuevas tengan límites más estrictos, en reportes por día y en alcance, hasta ganar
reputación. Los cupos ya existían (ADR 0131, 0132) y la reputación baja ya restaba en "Para ti" (ADR 0031). Faltaba
el alcance de las cuentas nuevas.

## Decisión

- En el orden de "Para ti", un post de una cuenta personal escrito en sus primeras 24 horas (`NEW_ACCOUNT_HOURS`, la
  misma ventana que el nivel NEW de reputación) resta 3 horas de ventaja.
- La señal depende de la hora del post y no del momento de la lectura, así el cursor sigue estable entre páginas.
- Es pequeña a propósito: en un desastre llega mucha gente nueva con información útil. No cambia Cerca, Siguiendo,
  el mapa ni la página del evento, y los reportes siguen formando eventos y verificándose igual.
- Los posts de negocios no se ven afectados (su sello de verificación es otro mecanismo).

## Consecuencias

- Una ola de cuentas recién creadas no puede dominar el descubrimiento, sin silenciar a nadie.
- Prueba en `new-account-reach.test.ts`.
