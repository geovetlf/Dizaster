# ADR 0231 — La IA tampoco puede sugerir FALSE

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

La regla es que la IA nunca produce `OFFICIALLY_CONFIRMED` ni `FALSE`. El servicio y la base solo impedían lo
primero: una sugerencia de IA con `suggestedNegative: "FALSE"` se guardaba.

## Decisión

- `recordAiSuggestion` rechaza `FALSE` con `AI_CANNOT_CONFIRM`, igual que `OFFICIALLY_CONFIRMED`.
- Migración 0096: `CHECK (suggested_negative IS DISTINCT FROM 'FALSE')` en `verification.ai_suggestions`.
- `DISPUTED` sí puede sugerirse: solo pide revisión humana y no cambia ningún estado.

## Consecuencias

- Las dos decisiones reservadas a fuentes oficiales y moderadores quedan cerradas a la IA en servicio y base.
- Prueba en `verification.test.ts`.
