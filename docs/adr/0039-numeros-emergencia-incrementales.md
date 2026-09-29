# ADR 0039 — Números de emergencia con actualización incremental

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §6.3 (`?since=version`), §11 (detección de país), RF-12, RF-13

## Contexto
La app solo usaba el dataset empaquetado: corregir un número exigía publicar una versión nueva en las tiendas,
lo que tarda días. Sin ubicación, además, caía directamente al 112 aunque el teléfono supiera su país.

## Decisión
- `GET /v1/reference/emergency-numbers?since=<versión>`: si la versión coincide con la vigente responde
  `{version, unchanged: true, numbers: []}`; si no, el dataset completo (o el de `country`). Cacheable en CDN.
- Versiones comparadas por tramos numéricos (`compareDatasetVersions`, en contracts): `2026.09.10 > 2026.09.9`.
- App: al abrir y en la pantalla de emergencia se consulta con la versión local. Una versión más nueva se valida
  con el esquema y se guarda en el almacenamiento de la app (`expo-file-system`). La pantalla muestra primero lo
  local, sin red, y se actualiza si llega algo nuevo. Si el empaquetado es más nuevo que el descargado (app
  actualizada), gana el empaquetado.
- País de reserva sin ubicación: región de los ajustes del teléfono (`es-PE` → `PE`), con un aviso visible.
  El país de la SIM queda fuera: requiere un módulo nativo y la región del sistema cubre el caso.

## Consecuencias
- Corregir un número es editar `data/emergency-numbers` y subir la versión; los teléfonos lo reciben al abrir la app.
- Coste: una petición de unos bytes por apertura, servible desde CDN.
- Un dataset inválido del servidor se descarta y el teléfono sigue con el que tenía.
