# ADR 0032 — Póster de video generado en el teléfono

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §7 (Media Engine), ADR 0011, ADR 0025, ADR 0030

## Contexto
Los videos se mostraban como un marco negro con ▶: el servidor no decodifica video (no hay ffmpeg y no se
añade: más superficie de ataque, CPU y costo). Sin miniatura tampoco había hash perceptual del video.

## Decisión
- La app extrae un fotograma (0,5 s, máx. 720 px de ancho) con `expo-video` (`generateThumbnailsAsync`) y lo
  guarda como JPEG con `expo-image-manipulator`; igual en Android e iOS, sin dependencias nuevas.
- El pedido de subida del video declara `poster {sizeBytes ≤ 1 MB, sha256}` y recibe una segunda URL firmada
  (`posterUpload`). Todo sigue siendo subida directa al almacenamiento.
- El worker trata el póster como una foto: verifica hash y tipo real, re-codifica sin metadatos (variantes
  `POSTER` y `THUMB_S`), borra el original del póster y usa su hash perceptual como el del video, así un video
  reciclado también se detecta (ADR 0025) y deduplica eventos (ADR 0030).
- Póster ausente, alterado o ilegible **no rechaza el video**: solo se queda sin miniatura.
- `MediaView.posterUrl` (nuevo) y `thumbUrl` del póster. En la galería del evento el video no se carga hasta
  tocarlo (ahorro de datos).

## Consecuencias
- El póster lo elige el teléfono y podría no corresponder al video; moderación lo ve como cualquier contenido.
  Aceptado frente al costo de decodificar video en el servidor.
- Videos subidos antes de esta versión quedan sin póster.
