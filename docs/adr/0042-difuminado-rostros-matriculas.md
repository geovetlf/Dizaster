# ADR 0042 — Difuminado de rostros y matrículas

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint D-08, C-07, §13 (contenido sensible), ADR 0035

## Contexto
D-08 incluye las categorías de delincuencia en V1 con la condición de no identificar a nadie y difuminar rostros y
matrículas. Hasta ahora solo existían el aviso de contenido gráfico y la revisión previa de media sensible.

## Decisión
- **Manual y en el servidor.** Al adjuntar una foto, la persona toca cada rostro o matrícula (recuadros en
  fracciones de la foto, hasta 20). El servidor, con `sharp` (ya en uso, sin coste extra), reduce cada zona a unos
  pocos píxeles y la desenfoca: el detalle se pierde, no es un filtro reversible. Se aplica a todas las variantes
  públicas (pantalla y miniatura).
- El hash perceptual se calcula sobre el original: una foto reciclada sin difuminar se sigue detectando (ADR 0025).
- El original privado conserva los rostros durante la retención de originales (para moderación y disputas) y
  después se borra, como cualquier original. Nunca es público.
- En categorías sensibles la app invita de forma destacada a difuminar; la media de esas categorías ya pasa por
  revisión antes de publicarse (ADR 0035), donde moderación puede rechazar una foto que identifique a alguien.
- **Videos: no en V1.** El servidor rechaza recuadros en videos; aceptar un difuminado que solo tape el póster daría
  una falsa sensación de protección.

## Siguiente paso (no implementado)
Detección automática con un modelo abierto (rostros; matrículas es más difícil), que solo **propone** recuadros en
el mismo formato para que la persona los confirme. Requiere elegir modelo y medir su coste en el worker; queda en el
backlog sin bloquear nada.
