# ADR 0006 — Mapa desacoplado y Geo Engine sin APIs comerciales

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §11

## Decisión
- Ubicación: APIs del sistema operativo (expo-location). Sin costo ni API de mapas.
- Geo Engine compartido (`packages/geo-kit`): distancias, H3, generalización, presencia, deduplicación y país por coordenadas con polígonos Natural Earth 1:50m (dominio público), empaquetados en la app → la detección de país y los números de emergencia funcionan offline y sin enviar la ubicación.
- Map Engine en la app depende solo de `MapProvider` (`apps/mobile/src/lib/map/provider.ts`), construido desde `/v1/config`. Cambiar de proveedor = cambiar configuración. Si el proveedor falla, un estilo local de fondo liso mantiene visibles los eventos.
- Desarrollo usa el estilo demo público de MapLibre. Producción: tiles OSM propios en PMTiles sobre object storage sin egreso + CDN (pendiente de cuenta cloud).
- MapLibre React Native 11 exige una *development build* (no funciona en Expo Go).
