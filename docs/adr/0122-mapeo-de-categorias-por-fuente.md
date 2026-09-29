# ADR 0122 — Mapeo de categorías por fuente como dato

Estado: aceptada (2026-09-29)

## Contexto
§9.4: "mapeo de categoría de la fuente → taxonomía de Dizaster, en una tabla configurable". Solo CAP leía su
`eventMap` del registro; GDACS, ReliefWeb y Copernicus EMS lo tenían fijo en código. USGS, EMSC y FIRMS publican un
único tipo (sismo o foco de calor) y no necesitan tabla.

## Decisión
- `config.categoryMap` en `data/source-registry/sources.json` (sources-2026.09.10) para `gdacs` (tipo GDACS),
  `reliefweb-disasters` (código GLIDE) y `copernicus-ems` (palabra de peligro, en orden: gana la primera). El mapa
  del código queda como valor por defecto del formato, igual al del registro (una prueba lo comprueba).
- Al cargar los datos de referencia se valida cada mapeo (`categoryMap` y `eventMap` de CAP): el destino debe ser
  una categoría hoja existente y estar en `categories` de la fuente. Si no, el servicio no arranca con ese registro.
- Añadir o quitar un tipo para una fuente, o una nueva fuente con un formato existente, es un cambio de datos.
  NO AI REQUIRED; costo 0.
