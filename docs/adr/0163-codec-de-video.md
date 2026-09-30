# ADR 0163 — Códec de video verificado en el servidor, sin transcodificar

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (lectura de cabeceras; sin transcodificación)

## Contexto

§12.1 fija video V1 en H.264, 720p, 60 s, reproducción MP4 progresiva y sin transcodificar. El servidor ya verificaba
duración y resolución desde el archivo (ADR 0071), pero no el códec: cualquier MP4 se publicaba tal cual, aunque un
teléfono no pudiera reproducirlo.

## Decisión

- `videoInfo` lee la primera entrada de `moov/trak(vide)/mdia/minf/stbl/stsd`: su tipo es el códec (`avc1`, `hvc1`…).
  Se guarda en `media.media.codec` (migración 0075).
- Admitidos: H.264 (`avc1`, `avc3`) y HEVC (`hvc1`, `hev1`). HEVC se admite porque iOS y muchos Android lo graban por
  defecto y ambos lo decodifican por hardware: rechazarlo perdería evidencia y transcodificar cuesta. Todo lo demás
  (MPEG-4 Part 2, AV1, VP9, contenido cifrado, sin pista de video) queda REJECTED con motivo "Códec de video no
  admitido"; la app ya muestra el rechazo en el reporte.
- En el teléfono se empuja a H.264: la captura en iOS usa calidad iFrame 720p (H.264) y un video elegido de la galería
  se exporta a H.264 1280×720 (`videoExportPreset`). En Android la cámara del sistema decide; por eso HEVC se acepta.
- Si en el futuro hiciera falta H.264 estricto (reproductores antiguos), el punto de cambio es
  `ACCEPTED_VIDEO_CODECS` más un trabajo de transcodificación con presupuesto propio; no se activa en V1.
