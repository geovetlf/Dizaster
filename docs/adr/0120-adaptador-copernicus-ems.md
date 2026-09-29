# ADR 0120 — Adaptador Copernicus EMS (cartografía rápida), fuente PLANNED

- Estado: aceptada (2026-09-29)
- Blueprint: §9.3 (fuentes globales: Copernicus EMS)
- IA: **NO AI REQUIRED**. Costo: 0 (feed público sin clave).

## Contexto
Copernicus EMS Rapid Mapping publica las activaciones que una protección civil pide cartografiar: desastres ya en
curso con impacto relevante. Sirve para corroborar externamente eventos grandes en cualquier país.

## Decisión
- Adapter `copernicus-ems-georss` (GeoRSS): identidad estable = código EMSR (de `guid`, título o enlace); punto de
  `georss:point` ("lat lng") o, si solo hay `georss:polygon`, el centro de su caja con incertidumbre de medio lado
  (25–200 km). País desde el título ("[EMSR812] Peru: …"), solo como dato bruto.
- Peligro → categoría por palabras de `category` o del título: inundación, sismo, tsunami, deslizamiento, volcán,
  tormenta/ciclón, sequía, ola de frío e incendio forestal. Un incendio industrial, un accidente o una crisis
  humanitaria no encajan y se ignoran (no se inventa categoría). Severidad 4 (una activación implica impacto).
- Nunca usa el carril urgente: llega horas después del suceso. Registrada en `sources.json` (sources-2026.09.9) como
  **EXTERNAL** (corrobora, nunca OFFICIALLY_CONFIRMED) y **PLANNED**: el planificador no la consulta hasta revisar la
  política de datos y la atribución, y validar el feed real (el sandbox no llega a emergency.copernicus.eu).

## Consecuencias
- Activarla es un cambio de dato (`status: ACTIVE`) tras esa revisión.
- Pruebas: `services/core/test/copernicus-ems.test.ts` con `fixtures/copernicus-ems.xml`.
