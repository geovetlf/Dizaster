# ADR 0030 — Huella de deduplicación: texto y fotos (dedup-2)

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8.4 (sim_texto, sim_media), ADR 0025

## Contexto
La puntuación de coincidencia de §8.4 incluye similitud de texto y de fotos. Hasta ahora el término de texto
existía pero los candidatos no traían palabras clave (siempre neutro) y el de fotos no existía.

## Decisión
- Cada EVENT guarda una **huella** propia: palabras clave (máx. 50) y hashes perceptuales de sus fotos (máx. 20),
  en `event.events.keywords` y `media_hashes`. Se amplía con cada evidencia; el tope evita que el costo crezca
  con el tamaño del evento. Nada de esto es público.
- **dedup-2**: pesos distancia 0,40 · tiempo 0,22 · categoría 0,18 · texto 0,10 · fotos 0,10; umbrales sin
  cambios (0,80 adjuntar, 0,55 ambiguo). Sin fotos o sin texto en algún lado el término es neutro (0,5).
  Fotos: el par más parecido decide; ≤ 6 bits = misma escena (1), ≥ 24 bits = distinta (0), lineal entre medias.
- El reporte envía los hashes de sus fotos ya procesadas. Si una foto termina de procesarse después,
  `MediaReady` lleva su hash y el Event Engine lo suma a los eventos donde se publicó (índice GIN sobre la
  timeline `MEDIA_ADDED`).
- Sin IA y sin servicios de pago: todo es determinista y se versiona (`dedupRuleVersion`).

## Consecuencias
- Un caso perfecto sin texto ni fotos puntúa 0,90 (antes 0,95); sigue muy por encima de 0,80.
- Métricas de calidad (ADR 0026) permiten vigilar la tasa de fusiones para recalibrar.
