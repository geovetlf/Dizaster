# ADR 0243 — Tareas de mantenimiento aisladas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Las tareas horarias y diarias del worker iban encadenadas sin try/catch propio, y la marca de "ya corrió" se ponía
antes. Si fallaba una (p. ej. borrar originales con el almacenamiento caído), las siguientes se saltaban hasta el
día siguiente, y todos los días si el fallo persistía. Entre ellas estaba la generalización de la presencia a los
30 días (§13.2 / D-06), un plazo de privacidad.

## Decisión

- `src/maintenance.ts`: listas `hourlyJobs` y `dailyJobs`, y `runJobs`, que ejecuta cada tarea con su propio
  try/catch, registra el fallo y sigue.
- La generalización de presencia va primera en la lista diaria.

## Consecuencias

- Un fallo aislado ya no deja datos personales más tiempo del prometido. Prueba en `maintenance-jobs.test.ts`.
