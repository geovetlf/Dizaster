# ADR 0221 — Bloqueo efectivo y posición del feed "Cerca" redondeada en el servidor

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Una auditoría del código contra el Blueprint encontró dos huecos:

- Bloquear (ADR 0020) solo ocultaba contenido a quien bloquea y cortaba los seguimientos. La persona bloqueada podía
  volver a seguir, comentar, reaccionar y compartir los posts de quien la bloqueó (§13.3, acoso).
- `GET /v1/feed` aceptaba coordenadas con precisión completa y devolvía un tramo de distancia por post. Los posts de
  reporte guardan su punto público generalizado por categoría (en NORMAL, una celda H3 de unos 65 m). Con consultas
  desde coordenadas elegidas se podía acotar el punto de cada reporte (§8.5, C-02). La app ya redondeaba, pero el
  servidor no.

## Decisión

- Quien fue bloqueado recibe `BLOCKED` (403) al comentar, reaccionar o compartir un post con nombre de quien lo
  bloqueó, al responder a su comentario o al seguirlo. Quitar una reacción propia sigue permitido. En posts seudónimos
  no se aplica, porque rechazar revelaría al autor.
- El servidor redondea la posición del feed a 0,01° (unos 1,1 km) antes de filtrar y calcular distancias, igual que la
  app. Los tramos de distancia empiezan en 1 km.
- En la app, el interruptor de costo muestra el error si el servidor rechaza el cambio.

## Consecuencias

- Bloquear protege de verdad sin exponer autores seudónimos.
- La distancia de un post solo dice en qué celda de ~1 km está quien lee, lo que no permite triangular reportes.
- Pruebas en `block-enforcement.test.ts`.
