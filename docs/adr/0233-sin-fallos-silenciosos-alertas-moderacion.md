# ADR 0233 — Sin fallos silenciosos en alertas y moderación

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Quitar una zona o una suscripción de alerta cambiaba la pantalla antes de llamar al servidor e ignoraba el error. Sin
red, la persona creía haber dejado de recibir alertas (o haberse suscrito) y no era así; además se borraba el mapa
offline de la zona. En moderación, una carga fallida mostraba "no hay casos" o una lista vacía.

## Decisión

- Zonas y suscripciones: primero el servidor. Si falla, la pantalla no cambia y se muestra "No se guardó el cambio"
  con el motivo traducido. El mapa offline de una zona solo se borra cuando el servidor confirmó.
- Cola de moderación, apelaciones y duplicados: cada pestaña que no cargó muestra el estado de error compartido con
  Reintentar (ADR 0212); el mensaje de vacío solo aparece si la carga salió bien.
- Mis avisos de moderación: cargando, error con Reintentar o la lista (con mensaje propio si está vacía).

## Consecuencias

- Nadie queda sin alertas creyendo que las tiene. Prueba en `no-silent-failures.test.ts`.
