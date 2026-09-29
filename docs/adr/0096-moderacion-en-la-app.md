# ADR 0096 — Disputa, falsedad y duplicados en la app de moderación

- Estado: aceptada (2026-09-29).
- Blueprint: §5.21, D-12 (sin panel web: todo en la app), §10.2, ADR 0034, ADR 0076
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

El servidor ya permitía marcar un EVENT como en disputa o falso (`POST /v1/moderation/events/:id/negative-state`) y
tenía la cola de posibles duplicados (`GET /v1/moderation/duplicates` y descartar, ADR 0076). La app no ofrecía
ninguna de las dos cosas, y V1 no tiene panel web.

## Decisión

- **Herramientas del evento.** Se añade la sección "Disputa o falsedad", con tres opciones: sin marca, en disputa
  y falso.
  - Siempre exige el motivo común de la pantalla (10 caracteres como mínimo) y una confirmación.
  - FALSO exige además seleccionar la evidencia que lo prueba, con la misma selección que se usa para dividir.
  - FALSO se desactiva en un evento confirmado oficialmente: solo una fuente oficial puede desmentirlo, y el
    servidor lo impide igual (409).
- **Pestaña "Duplicados".** Se añade a la pantalla de moderación. Cada par muestra por qué entró en la cola, el
  puntaje y los dos eventos, con enlace a sus herramientas. Hay tres acciones, todas con motivo:
  - unir el 2 en el 1;
  - unir el 1 en el 2;
  - "No son el mismo", que descarta el par.
- **Criterio en la app.** `canSetNegative` decide qué botones se activan, con el mismo criterio que el servidor.

## Consecuencias

- Todo lo que la moderación puede hacer por la API se puede hacer desde el teléfono.
- Cada cambio queda en `verification.transitions` o en el registro de fusiones, con su motivo.
- Pruebas: `apps/mobile/test/moderation-logic.test.ts`. Las rutas ya estaban probadas en
  `services/core/test/verification.test.ts` y en la prueba de duplicados de ADR 0076.
