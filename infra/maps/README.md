# Mapa base propio (PMTiles) y mapas sin conexión

Pipeline para servir el mapa desde nuestro object storage sin proveedor de pago (Blueprint §11, ADR 0006, ADR 0041).

| Paso | Comando | Estado |
|---|---|---|
| 1. Extraer el país del build planetario de Protomaps | `infra/maps/build-region.sh PE` | Listo (requiere el binario `pmtiles`) |
| 2. Descargar fuentes y sprites | `infra/maps/fetch-assets.sh` | Listo |
| 3. Generar estilos claro/oscuro | `TILES_URL=… ASSETS_URL=… node infra/maps/make-style.mjs` | Listo y probado |
| 4. Subir al bucket | `infra/maps/publish.sh` (simula) / `--apply` | **BLOQUEADO**: falta aprobar storage y bucket |
| 5. Apuntar la app | `MAP_STYLE_URL_LIGHT`, `MAP_STYLE_URL_DARK` en el servidor | Tras el paso 4 |

- `country-bbox.mjs` calcula la caja del país con los mismos polígonos Natural Earth que usa la app.
- Perú hasta z15 pesa del orden de 1–2 GB; el coste es solo almacenamiento (sin egreso con un proveedor adecuado).
- Los datos son © OpenStreetMap (ODbL): la atribución va en el estilo y la app la muestra.
- La salida (`infra/maps/out/`) no se versiona.

## En la app
Cada zona guardada tiene un botón "Mapa sin conexión" (ajustes de alertas). Descarga con MapLibre offline packs
el rectángulo de la zona, bajando el zoom máximo para no pasar de ~3000 teselas. La caché automática del mapa se
limita a 50 MB. Solo aparece si `/v1/config` dice `offlineRegions: true`.

**Pendiente de validar en un teléfono:** que el paquete offline de MapLibre Native descargue fuentes `pmtiles://`.
Si no lo hiciera, se serviría el mismo archivo como TileJSON/XYZ desde la CDN (ver ADR 0041).
