# ADR 0101 — Roles verificador y operador

- Estado: aceptada (2026-09-29).
- Blueprint: §13.1 (RBAC: usuario, admin de negocio, moderador, verificador, operador, admin; mínimo privilegio;
  MFA para todo acceso administrativo)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Solo existían los roles `moderator` y `admin`, y cada ruta comparaba roles a mano. Quien solo tenía que ordenar
eventos duplicados o vigilar fuentes necesitaba un rol que también le abría los casos de moderación o la
administración completa.

## Decisión

- **Una sola tabla de permisos** (`packages/contracts/src/roles.ts`), compartida por servidor y app:

  | Permiso | Roles | Qué abre |
  |---|---|---|
  | `content.moderate` | moderador, admin | casos, apelaciones, consulta de presencia con motivo |
  | `event.verify` | verificador, moderador, admin | herramientas de EVENT (fusionar, dividir, revertir, ciclo de vida, disputa o falsedad), cola de duplicados |
  | `ops.view` | operador, admin | tableros de costo y calidad |
  | `ops.control` | operador, admin | kill switches |
  | `admin` | admin | presupuestos, sellos de negocio, ámbito institucional, registro de consultas de presencia |

- **Servidor.** Todas las rutas del personal pasan por `requirePermission`: rol permitido y, cuando es obligatoria,
  MFA verificada en la sesión (ADR 0090). Todo el personal puede configurar su segundo factor.
- **Avisos a operación.** Los operadores reciben, igual que administración, el aviso push de fuentes urgentes caídas o
  recuperadas. Los avisos de presupuesto siguen yendo solo a administración.
- **Alta de roles.** `grant-role-cli` acepta `moderator`, `verifier`, `operator` y `admin`.
- **App.** Muestra solo lo que el rol permite:
  - verificación ve "Moderación" solo con la pestaña de duplicados;
  - operación ve costo y calidad y usa los kill switches, pero no edita presupuestos;
  - todo el personal ve "Verificación en dos pasos".
- El "admin de negocio" ya existe como quien administra un perfil de negocio (ADR 0028). No es un rol de la cuenta.

## Consecuencias

- Agregar un rol o mover un permiso es cambiar una tabla.
- Pruebas: `services/core/test/roles.test.ts`, con la tabla y la matriz de rutas por rol.
