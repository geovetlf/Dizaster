# ADR 0327 — Solo administración suspende o reactiva una cuenta de administración

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §13.1 (roles), §5.21 (moderación); ADR 0101, 0167, 0214, 0319
- IA: **NO AI REQUIRED**. Costo: 0. Sin migración.

## Contexto

Con ADR 0319, `SUSPEND_USER` y `UNSUSPEND_USER` los aplica cualquier persona con `content.moderate` (moderación o
administración). La auditoría del 2026-10-11 encontró que una persona moderadora podía suspender a un administrador
(sobre un post, comentario, perfil o negocio suyo denunciado). Una cuenta suspendida no ejerce ningún rol, así que:

- moderación podía dejar al sistema sin ningún administrador activo, y entonces nadie podría quitarle su rol (la baja
  de roles es solo de administración, ADR 0167); solo quedaría la CLI del servidor;
- moderación podía deshacer, con `UNSUSPEND_USER` o revirtiendo la apelación, una suspensión que decidió
  administración.

La protección de «último administrador» (ADR 0167, 0235) solo cubría quitar el rol y borrar la cuenta, no suspender.

## Decisión

- Si la cuenta afectada tiene el rol `admin` (guardado, aunque esté suspendida), `SUSPEND_USER` y `UNSUSPEND_USER`
  exigen que quien actúa tenga el rol `admin` vigente (`liveRoles`). Si no: 403 `FORBIDDEN`, sin cambios ni registro.
- Vale igual al revertir una apelación: la inversa de una suspensión es `UNSUSPEND_USER`.
- Como quien suspende a un administrador es otro administrador activo (nadie se modera a sí mismo, ADR 0214), el
  sistema nunca queda sin administrador activo por una suspensión.
- Sin cambios entre personas moderadoras ni sobre cuentas sin rol: siguen como en ADR 0319. Si el propietario quiere
  que también las cuentas con rol `moderator`, `verifier` u `operator` solo las suspenda administración, es una
  decisión de producto aparte (queda en el informe de la auditoría).

## Pruebas

`test/staff-suspension.test.ts`:
- moderación no suspende a un administrador, y no queda registro;
- una cuenta sin rol se sigue suspendiendo desde moderación;
- administración suspende a otro administrador, que deja de ejercer su rol;
- moderación no lo reactiva ni revierte su apelación; otro administrador sí, y queda quién suspendió y quién revirtió;
- nadie se suspende a sí mismo.

## Consecuencias

- Un post denunciado de un administrador se sigue pudiendo ocultar o retirar desde moderación (apelable); solo la
  suspensión de la cuenta sube a administración.
