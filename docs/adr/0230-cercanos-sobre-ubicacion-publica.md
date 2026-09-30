# ADR 0230 — "¿Es este evento?" se calcula sobre la ubicación pública

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

`/v1/events/nearby` filtraba, medía y ordenaba contra la ubicación interna del evento (el pin del primer reporte) y
devolvía `matchScore` con tres decimales, una función continua de esa distancia. Con varias consultas se podía
triangular el punto interno, también en categorías sensibles. Contradice §8.5 y ADR 0012.

## Decisión

- El filtro, la distancia por tramos y el orden usan la ubicación pública (la misma que ya muestra el mapa). El radio
  se amplía con el margen de generalización de la sensibilidad del evento (`generalizationMarginM`, geo-kit), para no
  perder candidatos cercanos.
- `matchScore` deja de salir en la respuesta (la app no lo usaba); solo ordena en el servidor.
- La deduplicación interna al guardar un reporte no cambia: sigue usando el punto interno, que nunca sale.

## Consecuencias

- La respuesta no depende del punto interno. Prueba en `nearby-no-triangulation.test.ts` (mover el punto interno
  dentro de su celda no cambia la respuesta).
