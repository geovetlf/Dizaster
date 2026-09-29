# ADR 0103 — Timeline y verificación siguen la visibilidad del evento

- Estado: aceptada (2026-09-29). Corrige un hueco de ADR 0099.
- Blueprint: §8.5 (retraso de publicación), §13.1 (protección contra enumeración)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La ficha (`GET /v1/events/:id`), las fuentes y la media ya daban 404 para un evento oculto (HIDDEN) o retrasado
(DELAYED). Pero `/timeline` y `/verification` respondían con solo conocer el id. Así se podía confirmar que un
evento retrasado existía y ver su actividad antes de su hora.

## Decisión

- Las dos rutas comprueban primero la visibilidad pública con la misma lectura que la ficha: si no es visible,
  responden 404.
- La prueba de ADR 0099 comprueba ahora que ficha, timeline, verificación, fuentes y media dan 404 mientras el
  evento espera, y que responden al publicarse.

## Consecuencias

- Pruebas: `services/core/test/publish-delay.test.ts`.
