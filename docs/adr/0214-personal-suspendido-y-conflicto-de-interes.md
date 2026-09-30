# ADR 0214 — Personal suspendido sin poderes; nadie modera lo propio

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1 (RBAC con reglas por recurso) y §13.3 (acciones auditables, apelaciones imparciales).

- `liveRoles` solo excluía cuentas borradas: una persona moderadora suspendida seguía teniendo sus permisos y podía
  reactivarse a sí misma.
- La moderación no impedía actuar sobre el contenido, el perfil o el negocio propios.
- En las apelaciones solo se excluía a quien tomó la decisión original, no a quien apela.

## Decisión

- `liveRoles` solo devuelve roles de cuentas `ACTIVE`. Suspender o reactivar invalida la caché de roles al momento en
  esa instancia (≤ 30 s en las demás), igual que quitar un rol (ADR 0167).
- `apply` (lo usan las acciones sobre casos y la reversión de apelaciones) rechaza con 409 `CONFLICT_OF_INTEREST`
  cuando la cuenta afectada es la de quien actúa. La app ya traduce ese código.
- `decideAppeal` también rechaza a quien apela.

## Consecuencias

- La suspensión es efectiva también para el personal.
- Las decisiones sobre lo propio siempre las toma otra persona.
- Prueba `staff-conflict.test.ts`.
