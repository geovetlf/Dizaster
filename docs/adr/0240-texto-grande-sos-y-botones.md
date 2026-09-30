# ADR 0240 — SOS, contador y botones pequeños con texto grande

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Con el texto grande del sistema, "SOS" (dentro de una caja fija de 44×44) y el contador de alertas (alto fijo de 18)
se cortaban. Los botones de 24×24 de los adjuntos (quitar, marcar como impactante) quedaban por debajo del mínimo
táctil de 44 px en el flujo de reporte.

## Decisión

- Los botones de la cabecera usan `minWidth`/`minHeight` 44: crecen con el texto. "SOS" escala hasta ×1,6 y el
  contador hasta ×1,4 (`maxFontSizeMultiplier`), lo bastante para leerse sin romper la cabecera.
- Quitar y marcar como impactante añaden `hitSlop` de 10 (24 + 20 = 44 px). Los glifos de 24 px escalan hasta ×1,2.

## Consecuencias

- El botón de emergencia siempre se lee y se toca. Prueba en `large-text.test.ts`.
