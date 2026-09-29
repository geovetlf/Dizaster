# ADR 0080 — Adaptador EMSC (sismos), fuente PLANNED hasta revisar términos

- Estado: aceptada (2026-09-29)
- Blueprint: §9.3 (fuentes globales de sismos además de USGS)
- IA: **NO AI REQUIRED**. Costo: 0 (petición condicional a un servicio público; sin clave).

## Contexto

USGS cubre el mundo, pero para sismos moderados en Sudamérica y Europa el EMSC suele publicar antes y con la
agencia local como autora (p. ej. IGP en Perú). Sirve para corroborar externamente y para cubrir huecos.

## Decisión

- Adapter `emsc-fdsn-json` para el servicio FDSN event de EMSC con `format=json`: FeatureCollection, id `unid`,
  `time` ISO 8601, coordenadas `[lng, lat, -profundidad]`, región Flinn-Engdahl, `evtype`, `auth`.
- Solo sismos (`evtype` `ke`/`se`); voladuras y canteras se descartan. Magnitud mínima 3,5 (configurable); carril
  urgente desde 4,5. Severidad con la misma escala que USGS. Se guarda la agencia autora (`auth`).
- Registrada en `sources.json` (versión sources-2026.09.4) como **EXTERNAL** (agregador científico, no agencia
  oficial de un país: corrobora, nunca produce OFFICIALLY_CONFIRMED) y con estado **PLANNED**: el planificador no la
  consulta hasta que el dueño confirme que sus términos permiten el uso en la app.
- El formato se implementó según la documentación pública del servicio; el sandbox no llega a seismicportal.eu,
  así que la primera ejecución real debe revisarse al activarla.

## Consecuencias

- Activarla es un cambio de dato (`status: ACTIVE`) tras la revisión de términos.
- Pruebas: `services/core/test/emsc.test.ts` (normalización, descartes, urgencia, formato inválido, registro PLANNED).
