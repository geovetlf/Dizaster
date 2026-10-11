# ADR 0319 — Suspensiones escalonadas: 24 horas, 7 días o permanente

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §13 (moderación); decisión aprobada en ADR 0315; ADR 0113, 0134, 0214
- IA: **NO AI REQUIRED**. Costo: 0. Migración 0108 (solo añade columnas e índices).

## Contexto

`SUSPEND_USER` no vencía: la cuenta seguía suspendida hasta que moderación la reactivaba. El propietario aprobó el
2026-10-11 suspensiones de 24 horas, 7 días o permanentes, apelables, con registro auditable del motivo, la duración,
quién la aplicó y el resultado de la apelación, y con controles contra suspensiones o cambios no autorizados.

## Decisión

**Duración obligatoria.**
- `TakeActionRequest.suspension`: `HOURS_24`, `DAYS_7` o `PERMANENT`.
- Es obligatoria con `SUSPEND_USER` y se rechaza en cualquier otra acción (400).
- No hay duración por defecto: la elige quien modera.

**Datos (migración 0108).**
- `identity.users.suspended_until`: fin de la suspensión. NULL con `SUSPENDED` significa permanente. Así quedan las
  suspensiones anteriores a este cambio, que tampoco vencían.
- `moderation.actions.suspension` y `suspended_until`: la duración pedida y el fin efectivo de la cuenta. El registro
  sigue siendo de solo inserción (trigger de ADR 0113).

**Varias suspensiones.** Queda el fin más lejano. Una suspensión de 24 horas no acorta una de 7 días ni una
permanente. Una permanente gana siempre.

**Vencimiento.**
- El trabajo horario `moderation.suspensions.expire` reactiva las cuentas cuyo plazo terminó. Cada reactivación queda
  en el registro como `UNSUSPEND_USER` con autor `RULE`, sobre el mismo objeto que motivó la suspensión.
- Mientras el trabajo no pasa, una suspensión vencida ya no bloquea: `assertCanWrite`, los roles vigentes y el cupo
  por teléfono miran `suspended_until`.

**Apelación.** Sin cambios: la persona ve la duración y el fin en su aviso y puede apelar. Si se revierte, la cuenta
vuelve a `ACTIVE` y el resultado (`REVERSED` o `UPHELD`, quién decidió y el motivo) queda en `moderation.appeals`.

**Controles de autorización** (ya existían; ahora tienen pruebas propias):
- Solo moderación y administración pueden suspender, con MFA en producción (ADR 0090).
- Nadie modera su propio contenido ni decide la apelación de su propia acción (ADR 0214).
- Una cuenta suspendida no ejerce ningún rol hasta que su suspensión termina.
- El registro de acciones no se puede modificar ni borrar.

**App.** En el caso, moderación elige la duración antes de que se active «Suspender cuenta», y la confirmación la
repite. La línea de tiempo del caso, las apelaciones y «Mis avisos» muestran la duración y hasta cuándo.

## Pruebas

`test/suspension-durations.test.ts`:
- validación de la duración;
- 24 horas con registro, aviso y vencimiento automático;
- suspensión vencida que ya no bloquea;
- el fin más lejano gana;
- apelación revertida y su resultado;
- registro inmutable;
- conflicto de interés;
- persona suspendida que no modera.

En la app, `test/suspension-text.test.ts`.

## Consecuencias

- La duración de las suspensiones anteriores no se puede saber: siguen permanentes hasta que moderación las levante o
  una apelación las revierta.
- Una suspensión puede durar hasta una hora más en los listados que solo miran `status` (por ejemplo, el recuento de
  administradores activos), hasta que pasa el trabajo horario. Escribir y moderar ya miran el plazo.
