# ADR 0071: Duración y tamaño del video validados en el servidor

- Estado: aceptada (Blueprint §5.9 límite de 60 s, §12.1 costo, §13.1)
- IA: **NO AI REQUIRED**. API externa: ninguna. Costo: 0 (lectura de cajas ISO-BMFF, sin decodificar).

## Decisión

- Al procesar un video, `videoInfo()` lee `moov/mvhd` (escala de tiempo y duración, v0 y v1) y el `tkhd` de la pista
  cuyo `hdlr` es `vide` (ancho y alto en punto fijo 16.16).
- Se rechaza si la duración real es 0 o supera 60 s + 1 s de margen, si el lado mayor pasa de 4096 px, o si faltan
  `mvhd` o la escala de tiempo.
- La duración, el ancho y el alto guardados pasan a ser los reales, no los que declaró el teléfono (que solo sirven
  para rechazar antes de subir).
