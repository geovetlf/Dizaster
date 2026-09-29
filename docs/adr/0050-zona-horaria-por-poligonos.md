# ADR 0050 — Zona horaria por polígonos

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.5, §11.5, RF-12

## Decisión
- La zona horaria del contexto de un punto sale de los polígonos de *timezone-boundary-builder* (datos abiertos
  derivados de OSM, ODbL), empaquetados por la librería `geo-tz` (MIT). Va detrás de `TimezoneLocator` en el módulo geo.
- Regla: si el país tiene una sola zona en `country-config.json`, se usa esa sin leer polígonos (Perú). Si tiene varias
  o el país no está configurado, los polígonos. En el mar, la zona náutica (`Etc/GMT±N`).
- Se usa el conjunto "1970" (26 MB en disco), no el "now": el "now" fusiona zonas que hoy tienen la misma hora y
  devolvería `America/Caracas` para Manaus. La imagen Docker borra los otros dos conjuntos (≈ 45 MB).
- Los polígonos se leen del disco bajo demanda y se mantienen como mucho 64 trozos en memoria. El resultado queda en
  la memoria de contextos por celda H3 (`geo.context_cache`), así que cada celda se calcula una sola vez.
- La migración 0030 vacía esa memoria (es derivada) para recalcular los países con varias zonas.

## Por qué no PostGIS
- La descarga oficial del proyecto (releases de GitHub) no es accesible desde el entorno de construcción, y el
  paquete npm trae los mismos datos ya indexados. El resultado es el mismo sin importar 100+ MB a la base.
- Si más adelante se prefiere PostGIS, basta otra implementación de `TimezoneLocator`.

## Pendiente
- Atribución ODbL de los polígonos en la pantalla "Acerca de / licencias" (siguiente tarea).
- Para actualizar los límites, subir la versión de `geo-tz`.
