# ADR 0167 — Roles de personal: quitar roles y registro auditado

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1 pide mínimo privilegio y auditoría del personal. Los roles solo se daban por CLI, sin registro, y no había
forma de quitarlos: alguien que dejaba el equipo conservaba su acceso.

## Decisión

- `identity.role_changes` (migración 0076): cada alta y baja con cuenta, rol, quién, motivo y cuándo; solo inserción
  (trigger `platform.audit_append_only`, ADR 0113).
- `IdentityService.grantRole` registra (la CLI queda como actor `CLI`); `revokeRole` quita el rol, registra y cierra
  todas las sesiones de la cuenta (`ROLE_REVOKED`). Nunca se quita el rol al último administrador activo
  (`409 LAST_ADMIN`, con bloqueo para que dos bajas simultáneas no lo esquiven).
- Además del rol en el token, los permisos de personal comprueban el rol vigente en la base (`liveRoles`, caché de
  30 s): un rol quitado deja de valer en ≤ 30 s aunque el token de acceso siga vivo.
- `GET /v1/admin/staff` y `POST /v1/admin/staff/roles {handle, role, action, reason}` (solo administración, con MFA
  de personal). App: pantalla "Personal y roles" en el perfil de administración. CLI: `grant-role-cli --revoke`.
- Dar un rol sigue valiendo desde el próximo inicio de sesión (el token lleva los roles).
