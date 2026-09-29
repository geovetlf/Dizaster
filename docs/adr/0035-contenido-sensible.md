# ADR 0035 — Contenido sensible: aviso "tocar para ver" y aprobación de media

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §13.3, C-07, D-08, ADR 0020

## Contexto
El Blueprint pide pantallas de advertencia para imágenes gráficas. Además, la media de categorías sensibles
(delincuencia, violencia) ya se ocultaba hasta que moderación la aprobara, pero no existía forma de aprobarla
ni un caso que la llevara a la cola: esas fotos nunca se veían.

## Decisión
- `media.media.content_warning` (`GRAPHIC`) y `MediaView.contentWarning`. Tres orígenes:
  1. quien sube marca la foto o el video como impactante (`graphic` en el pedido de subida; botón ⚠ en la app);
  2. moderación aplica `MARK_GRAPHIC` a la media de un post;
  3. en categorías `HIGHLY_SENSITIVE` toda media aprobada sale con aviso (feed y galería del evento).
- La app la muestra difuminada (`blurRadius` del sistema, igual en Android e iOS) con "Contenido sensible · Toca
  para ver". Sin dependencias nuevas y sin descarga extra (se difumina la miniatura).
- Un post con media en una categoría no NORMAL publica `PostMediaNeedsReview` y abre un caso de sistema (motivo
  PRIVACY) para revisar rostros, matrículas e imágenes impactantes. `APPROVE_MEDIA` la hace visible y cierra el
  caso. Moderación ve la media del post en el caso.
- `APPROVE_MEDIA` no es sanción ni aviso para la persona; `MARK_GRAPHIC` sí se le informa.

## Consecuencias
- El difuminado automático de rostros y matrículas (D-08) sigue pendiente; hasta entonces decide una persona.
- Si la cola crece, la media de categorías sensibles tardará en verse: es el costo aceptado de no exponer víctimas.
