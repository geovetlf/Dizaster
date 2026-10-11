# ADR 0340 — Fin de la suspensión en el 403 `ACCOUNT_SUSPENDED`

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §5 (cuentas), §10 (moderación); ADR 0315, 0319
- IA: **NO AI REQUIRED**. Costo: 0. Sin migraciones.

## Contexto

Las suspensiones tienen plazo desde ADR 0319 (24 horas, 7 días o permanente). Al intentar escribir, una cuenta
suspendida recibía un 403 `ACCOUNT_SUSPENDED` con solo `error` y `message`. La app no podía decir «suspendida hasta
el …» sin otra consulta. `DomainError` solo serializaba esos dos campos.

## Decisión

**Detalles opcionales en `DomainError`.**
- `DomainError` admite un cuarto argumento opcional, `details`: un objeto plano de valores `string`, `number`,
  `boolean` o `null`.
- El manejador de errores lo escribe en el cuerpo **antes** que `error` y `message`. Un detalle nunca puede pisarlos.
- Los detalles se declaran a mano en cada `throw`. Nunca se pasa una fila de base de datos ni datos de otra persona.
- Sin `details`, el cuerpo es el de siempre (`error`, `message`).

**`suspendedUntil` en `ACCOUNT_SUSPENDED`.**
- `IdentityService.assertCanWrite` lee también `suspended_until` en la misma consulta (y la misma caché de 30 s).
- El 403 lleva `suspendedUntil`: fecha ISO 8601, o `null` si la suspensión es permanente.
- Solo lo recibe la persona afectada. `assertCanWrite` se llama únicamente con el `userId` de la propia sesión.
- El nombre coincide con lo que ya lee la app (`suspendedUntil`, PR #70).
- OpenAPI documenta el campo opcional en la respuesta de error.

## Pruebas

`test/config-launch-and-suspension.test.ts`:
- suspensión con plazo: `suspendedUntil` es el fin exacto y el cuerpo no trae más campos;
- suspensión permanente: `suspendedUntil` es `null`;
- otro error (401) sigue con solo `error` y `message`.

## Consecuencias

- Ninguna consulta nueva: la columna sale en la consulta que ya existía.
- Otros errores pueden añadir detalles con el mismo mecanismo. Cada uno exige revisar que el dato sea de la propia
  sesión.
