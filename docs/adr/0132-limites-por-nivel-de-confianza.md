# ADR 0132 — Límites sociales por nivel de confianza y tope diario de reportes

Estado: aceptada (2026-09-29)

## Contexto
§13.3 pide "límites más estrictos (reportes/día, alcance)" para cuentas nuevas o con mal historial. Solo el cupo de
reportes por hora dependía del nivel de confianza; publicaciones (20/h) y comentarios (10/min) eran fijos y no
había tope diario de reportes.

## Decisión
- `SOCIAL_LIMITS` en las reglas de Trust: TRUSTED y STANDARD 20 publicaciones/h y 10 comentarios/min; NEW 10 y 5;
  LOW 5 y 3. Nunca cero. El composer y los comentarios reciben el límite según la cuenta.
- Tope diario de reportes = 4 × el cupo por hora de la cuenta (ya escalado por confianza y por teléfono, ADR 0131),
  contado por cuenta y por teléfono en 24 h.
- Los números son configuración de reglas (cambiarlos es una decisión, como en el ADR 0022). NO AI REQUIRED.
