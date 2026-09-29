# ADR 0115 — Una fuente externa que dice "no ocurrió" pone el evento en disputa (verification-4)

Estado: aceptada (2026-09-29)

## Contexto
§10.2: fuentes contradictorias → DISPUTED. El motor solo usaba la negación de fuentes OFICIALES (→ FALSE) y de
personas (→ DISPUTED por peso). Con USGS y GDACS ya externas (ADR 0112), un sismo retirado por USGS
(`NOT_OCCURRING`) no tenía efecto.

## Decisión
- Reglas `verification-4`: evidencia de una fuente EXTERNAL registrada con `NOT_OCCURRING` → `DISPUTED`
  (regla `external-denial`), salvo que haya confirmación oficial (prevalece) o el evento ya sea FALSE. Nunca produce
  FALSE: eso queda para fuentes oficiales y moderación. El nivel positivo no baja (monotonía).
- Explicación `EXTERNAL_DENIAL` con nombre y hora de la fuente, en los cuatro idiomas; en ese caso no se añade la
  línea genérica de disputa entre personas. NO AI REQUIRED.

## Consecuencias
- Mientras la negación externa siga ahí, la disputa no se resuelve por confirmaciones ciudadanas; moderación puede
  quitarla con su flujo auditado.
