# ADR 0245 — Descartar un reporte en cola durante un envío

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

"Descartar" en Mis reportes quitaba el reporte del almacenamiento y borraba sus fotos, sin esperar al envío en curso,
que ya tenía el reporte en memoria. Podía pasar que el reporte se enviara igual (con la ubicación de la persona,
contra su decisión) o que volviera a la cola al guardar el progreso o el error.

## Decisión

- La cola recuerda los descartados de la sesión. Antes de subir, justo antes de enviar y al guardar progreso o error,
  comprueba que el reporte sigue en la cola; si no, no hace nada con él.
- `discardQueuedReport` borra las copias locales después de que termina el envío en curso.
- Un envío que ya salió hacia el servidor no se puede cancelar: el reporte queda como enviado y la persona lo puede
  retirar desde Mis reportes, como cualquier otro.

## Consecuencias

- Lo que la persona descarta no se publica ni reaparece. Prueba en `queue-discard.test.ts`.
