# ADR 0041 — Mapas sin conexión por zona guardada y pipeline PMTiles

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §11.3, C-04, ADR 0006, ADR 0022

## Contexto
En un desastre la red cae. La captura de reportes y los números de emergencia ya funcionan sin red, pero el mapa
solo tenía la caché de lo ya visto. Además faltaba el camino para dejar de usar el estilo de demostración.

## Decisión
- **App:** botón "Mapa sin conexión" en cada zona guardada. Descarga un paquete offline de MapLibre con el estilo
  del proveedor configurado, sobre el rectángulo de la zona (+10 %), de z8 a z15. Si pasa de 3000 teselas se baja el
  zoom máximo (una zona de 50 km sale con menos detalle). Antes de descargar se avisa del tamaño estimado. Al borrar
  la zona se borra su mapa. La caché automática se limita a 50 MB. Todo el cálculo está en `offline-plan.ts` (puro,
  probado); el módulo nativo solo ejecuta.
- **Servidor:** nada nuevo. El botón solo aparece si `/v1/config` tiene `offlineRegions: true` (config remota: se
  apaga sin publicar versión si el egreso sube).
- **Pipeline** (`infra/maps`): extraer el país del build planetario público de Protomaps con `pmtiles extract`,
  descargar fuentes y sprites, generar los estilos claro/oscuro con `@protomaps/basemaps` y subirlos al bucket.
  La subida está **BLOQUEADA** hasta aprobar storage (Blueprint D-18/D-21).

## Riesgos abiertos
- Validar en un teléfono que los paquetes offline de MapLibre Native descargan fuentes `pmtiles://`. Plan B:
  servir el mismo archivo como TileJSON/XYZ desde la CDN, sin cambiar la app (solo el estilo).
- Cada descarga es egreso: con el estilo de demostración actual no hay coste propio; con el bucket propio el
  límite de teselas y el kill switch remoto lo acotan.
