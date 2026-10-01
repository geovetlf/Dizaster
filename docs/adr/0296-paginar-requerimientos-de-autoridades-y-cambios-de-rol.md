# ADR 0296 — Paginar requerimientos de autoridades y cambios de rol

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §13.1 (administración), §15 (requerimientos de autoridades); ADR 0139, 0167, 0106
- IA: no. Costo: 0.

## Contexto

`GET /v1/admin/authority-requests` devolvía como mucho 200 registros y `GET /v1/admin/staff` solo los 50 cambios de rol
más recientes. Lo que quedaba fuera no se podía ver desde la app: un requerimiento antiguo o un cambio de rol de hace
meses desaparecía del registro auditado aunque seguía en la base.

## Decisión

1. `GET /v1/admin/authority-requests` acepta `cursor` (id del último) y devuelve `nextCursor`. El orden no cambia
   (abiertos primero, por vencimiento; luego más recientes); la página siguiente se calcula por ese mismo orden, con el
   id como desempate. Un cursor que no es de la lista da `VALIDATION`.
2. `GET /v1/admin/staff` devuelve `changesNextCursor`; los cambios más antiguos se piden en
   `GET /v1/admin/staff/changes?cursor=…` (solo administración), por `(at, id)` descendente.
3. La app pide la página siguiente al llegar al final de la lista de requerimientos y con un botón “Ver cambios
   anteriores” en Personal y roles.
4. Nada cambia en qué se registra ni en quién lo ve. Sigue siendo SOLO registro: ninguna pantalla entrega datos.
