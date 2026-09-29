# ADR 0014 — Media Engine V1: subida directa, saneamiento y retención

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §6 (Media), §12 (costos), D-06, D-08, D-18

## Decisión
1. **Subida directa firmada.** El dispositivo pide `POST /v1/media/uploads` (tipo, MIME, tamaño, SHA-256) y sube
   con `PUT` a una URL firmada por 15 min para ese tamaño y tipo exactos. El archivo nunca pasa por la API.
   Luego `POST /v1/media/:id/complete` comprueba que el objeto existe con el tamaño firmado.
2. **Proveedor intercambiable.** `StorageProvider` con dos implementaciones: `S3Storage` (firma SigV4 propia,
   sin SDK; sirve para R2, S3, B2, MinIO…) y `LocalDiskStorage` (solo desarrollo y pruebas; prohibida en producción).
   La firma se valida con el vector oficial de AWS y contra un servidor S3 (moto) en CI.
3. **Validación en el worker** (evento `MediaUploaded`, carril interactivo): hash SHA-256 igual al declarado,
   tipo real por firma de bytes (no por lo que diga el cliente), estructura del archivo válida.
4. **Privacidad sin re-codificar ni dependencias nativas:**
   - JPEG: se eliminan APP1 (Exif con GPS, XMP), APP13 (IPTC) y comentarios. Se conserva el perfil de color.
   - MP4/MOV: dentro de `moov` se neutralizan las coordenadas ISO 6709 (`©xyz` de Android,
     `com.apple.quicktime.location.ISO6709` de iOS) y la caja `loci`, sin cambiar tamaños ni tocar `mdat`.
   - Además la app re-codifica cada foto (≤1920 px, JPEG 0.7) antes de subirla, lo que ya descarta Exif.
   Solo la variante saneada (`DISPLAY`) se sirve; el original es privado.
5. **Límites V1:** foto JPEG ≤ 8 MB; video MP4/MOV ≤ 60 MB y ≤ 60 s (720p en la captura); 30 subidas por hora
   por perfil; 4 archivos por reporte.
6. **Visibilidad:** media `READY` y no retirada. En categorías sensibles (delincuencia, D-08) solo tras aprobación de
   moderación, hasta que exista difuminado automático de rostros y matrículas.
7. **Retención (cost-first):** los originales privados se borran a los 30 días (`MEDIA_ORIGINAL_RETENTION_DAYS`);
   quedan la variante pública y el hash. Las subidas abandonadas se eliminan.
8. **Reportes:** la media se adjunta al post del reporte (`social.post_media`, una media por post) y el evento
   registra `MEDIA_ADDED`. En la cola offline la foto se sube antes que el reporte; una foto rechazada no impide
   que el reporte llegue.

## Pendiente (no bloquea V1 inicial)
- Miniaturas y póster de video (requiere procesamiento de imagen en el worker; se decidirá librería y costo).
- Hash perceptual (duplicados y reutilización de fotos antiguas).
- Difuminado automático de rostros y matrículas (D-08).
- Directo (LIVE_STREAM): el modelo ya lo admite; sin implementación.
