# ADR 0012 — Reporte asistido: pin limitado y "¿es este el mismo evento?"

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8.1, §8.4

## Decisión
- El pin empieza en la ubicación del GPS y el usuario puede moverlo tocando el mapa, pero `clampToRadius` lo limita al `presenceRadiusM` de la categoría. El servidor recalcula la presencia igualmente.
- `GET /v1/events/nearby` (requiere sesión, sin caché) devuelve hasta 5 eventos compatibles cercanos, ordenados por la misma puntuación de deduplicación. Solo expone la ubicación pública generalizada y la distancia por tramos (`<100m`, `<500m`, `<2km`, `>2km`) para impedir triangular la ubicación interna.
- Elegir un evento envía `targetEventId`, la señal de deduplicación más fuerte y más barata (sin IA).
- El ciclo de vida por inactividad (`applyLifecycle`) pasa eventos a MONITORING (2 ventanas) y RESOLVED (6 ventanas, mínimo 24 h), con registro en la timeline.
