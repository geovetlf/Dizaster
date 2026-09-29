# ADR 0051 — Pantalla "Acerca de / licencias"

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §11.3 (ODbL: atribución "© OpenStreetMap contributors" visible)

## Decisión
- `GET /v1/about/attributions` (pública, cacheable 24 h) arma la lista desde los datos, no desde código: el proveedor de
  mapa (`MAP_ATTRIBUTION`), los datasets geográficos importados (`geo.datasets`, con su licencia del manifiesto), los
  polígonos de zona horaria (ADR 0050) y las fuentes activas del registro con su enlace de términos.
- La app tiene una pantalla "Acerca de y licencias" en el perfil: agrupa por tipo, colapsa atribuciones repetidas y
  añade la lista local de software libre (MapLibre, React Native, Expo, H3, Zod, iconos). Sin conexión muestra la
  parte local. La atribución del mapa sigue visible también sobre el mapa.

## Pendiente (propietario)
- Revisión legal de las obligaciones share-alike de ODbL para bases derivadas y de MPL-2.0 del índice de Perú.
- Los textos legales (términos, privacidad, aviso "no es un servicio de emergencias") se enlazarán aquí cuando existan.
