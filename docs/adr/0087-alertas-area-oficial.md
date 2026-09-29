# ADR 0087 — Alertas según el área oficial afectada

- Estado: aceptada (2026-09-29)
- Blueprint: §5.10, §9.4, ADR 0022, ADR 0033, ADR 0077
- IA: **NO AI REQUIRED**. Costo: 0 (PostGIS).

## Contexto

Las zonas guardadas, "cerca de mí" y los lugares seguidos se comparaban solo con el **punto** del evento. Una
alerta oficial CAP que cubre dos regiones queda representada por su centro: alguien con su casa dentro del área,
pero a 50 km del centro, no recibía el aviso.

## Decisión

- `event.events.affected_area` (MultiPolygon, migración 0040). Solo lo aportan **fuentes externas u oficiales**:
  - CAP `<polygon>` tal cual y `<circle>` como polígono de 32 lados (`NormalizedItem.area`).
  - Geocódigos (ADR 0077): la unión de las áreas administrativas, simplificada (~100 m); si no cabe en el contrato,
    su envolvente convexa.
  - Un candidato ciudadano nunca aporta área (se ignora aunque la traiga).
- Varias fuentes y las fusiones de eventos **unen** sus áreas.
- Al crear un evento (aviso NEW_EVENT) también reciben el aviso:
  - las zonas guardadas cuyo círculo toca el área;
  - la última ubicación aproximada que cae dentro del área;
  - quien sigue un área administrativa o se suscribió a ella, cuando cubre una parte real del área (más del 1 %
    de su superficie o 1 km²; tocar el borde no cuenta).
- El resto no cambia: preferencias, horas de silencio, límites y agrupación siguen igual.
- Contrato `AreaGeometry`: hasta 50 polígonos, 20 anillos y 2000 vértices por anillo.

## Consecuencias

- El mapa sigue mostrando el punto; dibujar el contorno queda para cuando haga falta (no es necesario para avisar).
- Al revertir una fusión, el evento destino conserva el área unida (solo afecta a avisos nuevos, que no se repiten).
- Pruebas: `services/core/test/alert-area.test.ts`, `services/core/test/geocodes.test.ts`, `packages/geo-kit`.
