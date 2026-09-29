# ADR 0074 — Textos idénticos entre reportes cuentan como un solo corroborador

- Estado: aceptada (2026-09-29)
- Blueprint: §10.2 (COMMUNITY_CORROBORATED "sin patrones idénticos"), §13.3 (anti-coordinación)
- IA: **NO AI REQUIRED**. Costo adicional: 0 (un hash por reporte, una columna).

## Contexto

Una campaña coordinada suele pegar el mismo texto desde varias cuentas. La anti-coordinación existente (ADR 0023)
mira cuentas jóvenes que coinciden en varios eventos; no ve el copiar y pegar dentro de un mismo evento.

## Decisión

- `textFingerprint` (`@dizaster/geo-kit`): texto sin mayúsculas, tildes, signos ni espacios extra. Solo si tiene
  ≥ 4 palabras: textos cortos iguales ("hay humo", "choque") son normales entre testigos reales.
- El Report Engine guarda en la evidencia del evento `text_hash` = SHA-256 de la huella (32 hex). No se guarda el
  texto de nuevo: ya vive en el post del reporte.
- Al calcular el peso independiente de la comunidad, cada grupo de reportes con el mismo `text_hash` aporta solo el
  mayor de sus pesos (`sameTextCountsOnce`), igual que un grupo coordinado. Aplica a confirmaciones y a desmentidos.
- Reportes anteriores a la migración 0037 no tienen hash y cuentan como antes.

## Consecuencias

- Tres cuentas que pegan "Choque grave en la avenida, hay heridos" suman como una.
- No detecta paráfrasis (sería trabajo para similitud de texto o IA); se prefiere el falso negativo al falso
  positivo contra testigos reales.
- Pruebas: `packages/geo-kit/test/geo-kit.test.ts`, `services/core/test/same-text.test.ts`,
  `services/core/test/verification.test.ts`.
