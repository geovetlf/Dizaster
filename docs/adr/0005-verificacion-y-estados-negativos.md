# ADR 0005 — Verification Engine, estados negativos y límites de la IA

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §10

## Decisión
- Dos dimensiones: nivel positivo monótono (UNVERIFIED → COMMUNITY_CORROBORATED → EXTERNALLY_CORROBORATED → OFFICIALLY_CONFIRMED) y estado negativo (NONE, DISPUTED, FALSE). Estado público: FALSE > DISPUTED > nivel.
- Reglas `verification-1`:
  - COMMUNITY: peso independiente ≥ `communityThreshold` de la categoría. Solo presencia HIGH, una vez por persona y por dispositivo; cuentas de < 24 h pesan 0,5.
  - EXTERNALLY: evidencia de una fuente registrada con `trust_tier = EXTERNAL` (el nivel se lee del registro de fuentes, no de la evidencia).
  - OFFICIALLY_CONFIRMED: evidencia de una fuente registrada con `trust_tier = OFFICIAL`.
  - DISPUTED: ≥ 2 contra-reportes independientes con presencia alta y ≥ 50 % del peso de confirmación. Se levanta cuando las confirmaciones lo duplican. Una confirmación oficial lo anula.
  - FALSE: solo por desmentido de fuente oficial registrada o por moderación con motivo (≥ 10 caracteres) y evidencia. Los votos ciudadanos nunca producen FALSE. Un evento confirmado oficialmente solo puede pasar a FALSE por desmentido oficial.
- Defensa en profundidad en la base de datos (`verification.transitions`): `OFFICIALLY_CONFIRMED` exige `cause = OFFICIAL_SOURCE` con evidencia; `FALSE` exige fuente oficial o moderador con motivo y evidencia. `AI` no es una causa válida.
- La IA solo escribe en `verification.ai_suggestions` (que prohíbe sugerir OFFICIALLY_CONFIRMED) y ninguna regla lee esa tabla.
