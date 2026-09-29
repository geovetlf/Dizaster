# ADR 0016 — Índice geográfico abierto: país → región → ciudad → distrito

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5 (`resolveAdmin`), §11 (geocodificación propia con datos abiertos), ADR 0004, 0006

## Contexto
Cada EVENT necesita un lugar legible ("Miraflores, Lima") sin pagar una API de geocodificación por reporte y sin
revelar dónde estaba quien reportó. El Blueprint ya fija PostGIS + H3 y datos abiertos.

## Decisión
- **Esquema `geo` propio** (módulo geo): `admin_areas` (MultiPolygon, niveles 1 región · 2 provincia/subregión ·
  3 distrito), `places` (localidades puntuales), `datasets` (fuente, licencia, atribución, sha256) y `context_cache`.
- **Datos como manifiesto** (`data/geo/datasets.json`): URL, sha256 fijado, licencia y mapeo de propiedades. Añadir
  un país = añadir datos. Varias fuentes pueden cubrir un nivel; gana la de mayor prioridad.
  - Global: Natural Earth 10m admin-1 y populated places (dominio público).
  - Perú (piloto): departamentos, provincias y distritos con ubigeo INEI (juaneladio/peru-geojson, MPL-2.0).
- **Qué es "ciudad" y "distrito" lo dice cada país** (`country-config.json` → `geo`). Perú: ciudad = provincia,
  distrito = distrito. Países sin configuración: ciudad = localidad Natural Earth más cercana (≤30 km), sin distrito.
- **Resolución**: `ST_DWithin` sobre índice GiST + `ST_Intersects`. Tolerancia de ~2 km solo si el punto cae fuera
  de los polígonos de la fuente principal (costa, mar cercano). Si el punto está en tierra y falta su distrito en la
  fuente, se omite el distrito: un vecino sería un nombre falso.
- **Memoria por celda H3 r9** en `geo.context_cache`; cada importación la vacía. Medido con los datos completos:
  p50 1,8 ms y p95 ~10 ms sin memoria, 0,13 ms con memoria.
- **Tres ubicaciones separadas**:
  1. Privada de presencia (report.presence_evidence): solo para verificar, nunca sale.
  2. Pública del EVENT (`public_geom`, generalizada por sensibilidad).
  3. Contextual (`event.events.place`, `region_id`, `district_id`): calculada SIEMPRE desde la pública.
- **Detalle por sensibilidad**: NORMAL y SENSITIVE muestran distrito; HIGHLY_SENSITIVE solo ciudad (ni siquiera se
  guarda el distrito en el evento).
- **Búsqueda de lugares** (`GET /v1/geo/areas`): prefijo de palabra sin tildes (trigramas), homónimos ordenados por
  cercanía aproximada del lector (2 decimales, opcional), nivel con nombre del país ("Distrito"). La fuente oficial
  oculta a la global en el mismo nivel.
- La app no llama a ningún geocodificador: recibe `place.label` ya resuelto.

## Consecuencias
- Costo por reporte: cero llamadas externas. Importación: ~50 MB de descarga, una vez (`pnpm geo:import`).
- Limitaciones conocidas: la fuente de Perú trae 8 distritos sin geometría (p. ej. Santa Anita, La Punta, Amantaní)
  y nombres sin tildes; se corrigen palabras frecuentes con `wordFixes` por país. Sustituible por límites oficiales
  INEI/IGN cambiando solo el manifiesto.
- Zona horaria: por país cuando es única; países con varias quedan con `null` hasta importar timezone-boundary-builder.
- Pendiente legal: confirmar el uso de datos MPL-2.0 (solo servidor, con atribución).
