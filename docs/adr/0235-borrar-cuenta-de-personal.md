# ADR 0235 — Borrar la cuenta de alguien del personal

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Borrar la cuenta vaciaba `roles` sin escribir en `identity.role_changes` y sin la protección del último
administrador de `revokeRole` (ADR 0167). El único administrador podía borrar su cuenta y dejar el sistema sin
nadie que administre, y la lista de personal no mostraba esa baja.

## Decisión

- En la misma transacción del borrado: si la cuenta es administradora, se toma el mismo candado que `revokeRole` y
  se exige al menos otro administrador activo; si no hay, 409 `LAST_ADMIN` ("nombra a otro antes de borrar tu
  cuenta") y la cuenta sigue intacta.
- Cada rol de personal que tenía queda como `REVOKE` en `identity.role_changes` con motivo "Cuenta borrada" y la
  propia cuenta como actor.

## Consecuencias

- El sistema siempre conserva un administrador y el historial de personal es completo.
- Prueba en `staff-account-deletion.test.ts`.
