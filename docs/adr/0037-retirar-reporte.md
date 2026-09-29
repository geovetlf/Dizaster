# ADR 0037 — Retirar un reporte propio

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §6.1 (`withdrawReport`), §13.2, ADR 0021, ADR 0023

## Contexto
Un post de reporte no se podía borrar porque es evidencia de un EVENT; la única salida era borrar la cuenta.
El Blueprint prevé retirar reportes y el modelo ya tenía `status = WITHDRAWN`.

## Decisión
- "Borrar" un post propio de tipo REPORT (`DELETE /v1/posts/:id`) retira el reporte. Idempotente.
- La evidencia queda `DETACHED` (se conserva para auditoría, deja de contar); geometría y contadores se
  recalculan y verificación, alertas y feed reevalúan (`EventEvidenceAdded`). Timeline pública:
  `REPORT_WITHDRAWN`, sin identidad.
- Un evento que se queda sin evidencia activa pasa a `HIDDEN`.
- El post y su media se borran; la presencia precisa se generaliza en el acto.
- Reputación: si el evento aún no se decidió, la contribución se olvida (corregir un error no penaliza). Si ya
  se decidió (confirmado o falso), se conserva: retirar después de un desmentido no limpia el historial.
- La app ofrece "Retirar reporte" con una confirmación que explica lo anterior.

## Consecuencias
- Un nivel de verificación ya alcanzado no baja solo por retirar (monotonicidad, §10.2); las banderas sí se
  reevalúan.
