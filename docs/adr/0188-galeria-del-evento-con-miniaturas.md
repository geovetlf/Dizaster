# ADR 0188 — Galería del evento con miniaturas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: reduce tráfico de almacenamiento y datos móviles

## Contexto

§12.1: las listas usan variantes pequeñas y la imagen grande solo al abrirla. El feed ya lo hacía (`imageUri`), pero
la galería de la ficha del evento descargaba cada foto a tamaño completo solo para una tira de 180 px de alto.

## Decisión

- `EventMedia` muestra `thumbUrl` (con `url` de respaldo si aún no hay miniatura) en la tira.
- Al tocar una foto se abre un visor a pantalla completa con la variante grande (`contain`) y botón Cerrar
  traducido. Mismo componente en Android e iOS; la cubierta de contenido sensible sigue delante.
- Los videos ya cargaban solo el póster hasta tocar (sin cambios).

## Consecuencias

- Una ficha con 4 fotos pasa de ~4 imágenes de 1920 px a 4 miniaturas; la grande solo si se abre.
