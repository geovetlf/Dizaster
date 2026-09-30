# ADR 0254 — Borrar un negocio borra su media, ediciones y contacto en una transacción

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
`DELETE /v1/businesses/:handle` marcaba el negocio y sus posts como borrados, pero dejaba el logo y las fotos de
sus posts en el almacenamiento, el historial de ediciones (textos anteriores, ADR 0209), la descripción, la dirección
y el contacto. Además hacía varias escrituras sueltas: un fallo a mitad dejaba el negocio a medio borrar (§13.2).
El borrado de cuenta tenía su propia versión de la misma lógica, también incompleta.

## Decisión
- `wipeBusinesses(q, ids)` en `social/business.ts` es la única rutina de borrado de negocios: vacía los datos del perfil
  (conserva el handle para que nadie lo suplante), vacía y marca sus posts, borra ediciones, etiquetas, menciones,
  seguidores y bloqueos, y devuelve la media usada (fotos de posts y logo).
- La ruta borra dentro de `withTransaction`: `business.delete` → `media.purgeMedia` → `institutions.retire`.
- El borrado de cuenta usa la misma rutina; su media ya la purga `media.purgeOwner`.

## Consecuencias
- Prueba en `test/avatars.test.ts`.
