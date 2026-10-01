# ADR 0299 — Paginar los registros de acceso de administración y mostrar quién consultó

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §7.3 (evidencia de presencia), §13.1 (auditoría de moderación); ADR 0089, 0098, 0168, 0296
- IA: no. Costo: 0.

## Contexto

La pantalla "Accesos a presencia" de administración mostraba la primera página del registro de consultas a la
evidencia de presencia (100 entradas, sin cursor en la API) y la primera página de originales de fotos y videos vistos
por moderación (la API ya tenía cursor, la app no lo usaba). Lo más antiguo no se podía revisar desde la app aunque
siguiera en la base. Además:

- quien consultó aparecía solo como un id corto, difícil de cruzar con "Personal y roles";
- un fallo al cargar los originales se ignoraba en silencio;
- la palabra "media" estaba escrita a mano, sin traducir.

## Decisión

1. `GET /v1/admin/presence-access` acepta `reportId`, `actorUserId`, `cursor` (id de la última entrada) y `limit`
   (1–200, 100 por defecto). Devuelve `{ entries, nextCursor }`, ordenado por `(accessed_at, id)` descendente. Un
   cursor que no es del registro da `VALIDATION`.
2. Las dos rutas (`presence-access` y `media-original-access`) añaden `actorHandle`, el alias del perfil de quien
   consultó, o `null` si no lo tiene. Siguen siendo solo de administración y `no-store`. El hash del token de un
   original no sale nunca.
3. La app carga la página siguiente de presencias al llegar al final de la lista. Los originales anteriores se cargan
   con el botón "Ver originales anteriores". Muestra `@alias` y, si no hay, el id corto. Los errores de las dos
   cargas se muestran con `ErrorText`, y "media" pasa a la clave traducida `mediaWord`.
4. No cambia qué se registra ni quién lo ve. Los registros siguen siendo solo de inserción.

## Consecuencias

- Todo el registro auditado es revisable desde la app, sin tope fijo.
- El alias se resuelve en la capa HTTP con `social.handlesForUsers`. El módulo `report` no consulta otro esquema.
- Pruebas: `services/core/test/admin-access-logs.test.ts` cubre:
  - el recorrido completo por páginas sin repetir;
  - los filtros;
  - el cursor inválido;
  - el 403 a moderación;
  - el alias;
  - que el hash del token de un original no sale nunca.
