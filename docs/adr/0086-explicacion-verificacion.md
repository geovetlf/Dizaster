# ADR 0086 — Explicación legible completa del estado de verificación

- Estado: aceptada (2026-09-29)
- Blueprint: §10.4, ADR 0081
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

§10.4 pide una explicación como "Corroborado por la comunidad: 5 personas en el lugar entre 14:05 y 14:20.
Corroborado externamente: detección satelital de NASA FIRMS 14:30. No confirmado oficialmente todavía."
La app solo mostraba recuentos: sin horas, sin nombres de fuentes, sin decir qué faltaba y sin explicar un FALSE
puesto por moderación ni un DISPUTED.

## Decisión

- El motor guarda, por línea de fuentes (`EXTERNAL_SOURCES`, `OFFICIAL_CONFIRMATION`, `OFFICIAL_DENIAL`), el
  recuento, los **nombres de las fuentes registradas** (sin repetir, hasta 3 y "+N") y la **hora más reciente**
  (`published_at`, o la de recepción). La línea ciudadana ya traía `from`/`to` (ADR 0081).
- Las líneas que dependen del estado y no de la evidencia se añaden **al leer** (`withStateLines`), para que un
  cambio de moderación se explique en el acto: `MARKED_FALSE` (FALSE sin desmentido oficial), `DISPUTED` y
  `NOT_OFFICIAL_YET` (cualquier nivel por debajo de OFFICIALLY_CONFIRMED, salvo FALSE).
- App: variantes detalladas de cada línea en es/en/pt/fr; las horas se muestran en la zona del evento. Una
  explicación guardada antes (sin nombres ni horas) usa la línea corta.
- Nunca se nombra a quien reportó; solo fuentes registradas.

## Consecuencias

- Pruebas: `services/core/test/verification-explain.test.ts`, `apps/mobile/test/verification-explain.test.ts`.
