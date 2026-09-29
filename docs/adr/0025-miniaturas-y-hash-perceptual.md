# ADR 0025 — Miniaturas, versión de pantalla y hash perceptual de fotos

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint RF-10, §5.9, §9 (sim_media), §10 (IA: imagen reutilizada)

## Decisión
- **sharp** (libvips, código abierto, binarios precompilados para Linux) en el worker. Sin servicio de pago.
- Cada foto se decodifica y se **re-codifica**: `DISPLAY` (lado mayor ≤ 1600 px, JPEG calidad 80) y `THUMB_S`
  (≤ 400 px, calidad 70). La orientación Exif se aplica antes y la salida no lleva **ningún** metadato. Lo que
  no se puede decodificar se rechaza, y las imágenes de más de 50 MP también (protección contra "bombas").
  El saneado byte a byte de ADR 0009 sigue corriendo como primera validación.
- `MediaView.thumbUrl` nuevo. La app carga la miniatura en las celdas pequeñas del mosaico y la versión de
  pantalla en lo que ocupa el ancho: menos datos para quien mira y menos CDN.
- **Hash perceptual** (pHash por DCT, 64 bits) en `media.media.phash`, con 8 bandas de 8 bits indexadas (GIN):
  si dos hashes difieren en ≤ 7 bits al menos una banda coincide, así que la búsqueda de parecidos es por
  índice y luego se confirma la distancia (≤ 6 bits = misma foto).
- **Foto reciclada**: si una foto nueva es casi idéntica a otra subida hace más de una hora **por otra
  persona**, queda `reuse_suspected` y se publica `MediaReuseDetected`. Moderación abre (o suma a) un caso por
  cada post que la usa, con una señal de sistema (`FALSE_INFO`, con nota) que no cuenta para el límite
  automático. Nunca se rechaza ni se oculta nada por esto: decide una persona. Si la foto se procesa antes de
  adjuntarse, el reporte emite la señal al adjuntarla.
- Videos: sin cambios (copia saneada). El póster de video necesita ffmpeg en el worker: queda pendiente.

## Consecuencias
- Coste: CPU del worker (milisegundos por foto) a cambio de mucho menos egreso de CDN.
- Pendiente: póster y variantes de video, usar `sim_media` en la deduplicación de EVENTs, y difuminado de
  rostros y matrículas (D-08).
