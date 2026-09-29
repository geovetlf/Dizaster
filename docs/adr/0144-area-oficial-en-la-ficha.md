# ADR 0144 — Área oficial afectada en la ficha del evento, guardada por evidencia

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno (mismo mapa y teselas que el resto de la app)
- PRIVACY_IMPACT: ninguno: el área solo la aportan fuentes externas u oficiales, nunca un reporte ciudadano.

## Contexto

ADR 0087 guardó el área oficial para alertas y dejó el dibujo "para cuando haga falta". Además, al revertir una
fusión el destino conservaba el área del absorbido, porque solo se guardaba la unión en el evento.

## Decisión

- `event.evidence.area`: cada evidencia externa/oficial guarda su propia área. `affected_area` del evento se
  recalcula como la unión de las áreas de sus evidencias activas al adjuntar, fusionar, revertir y dividir.
  Migración: el área de cada evento existente pasa a su evidencia externa u oficial activa más antigua.
- `GET /v1/events/:id` devuelve `affectedArea` (MultiPolygon simplificado ~500 m, 4 decimales). No va en listas
  ni en el mapa general, para no aumentar su peso.
- La ficha muestra un mapa pequeño y estático con el contorno y el punto, en el color de la categoría, igual en
  Android e iOS.
