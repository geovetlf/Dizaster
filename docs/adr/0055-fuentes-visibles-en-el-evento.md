# ADR 0055 — Fuentes visibles en el evento

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §9.3 (atribución visible), §10.1, §10.4

## Decisión
- `GET /v1/events/:id/sources` (pública, cache 60 s) lista las fuentes externas y oficiales que hoy respaldan el
  evento: nombre, nivel (OFFICIAL/EXTERNAL), licencia, términos, enlace al original, título y hora de publicación, y si
  la fuente lo desmiente o retiró. Una fila por fuente (la publicación más reciente); oficiales primero.
- Las referencias salen de la evidencia activa del evento (módulo event), así que una fusión trae las fuentes del
  evento absorbido. Los datos salen del módulo ingestion. Ningún módulo consulta el esquema del otro.
- `NormalizedItem.link` es nuevo: USGS (`url`), GDACS (`link`) y CAP (`info/web`) lo rellenan. Los ítems anteriores
  usan el enlace crudo guardado. Solo se devuelven enlaces `https` (el texto viene de terceros).
- Los reportes ciudadanos nunca aparecen aquí: la autoría ciudadana puede ser seudónima.
- La ficha del evento muestra la sección "Fuentes", y cada fila abre el original.
