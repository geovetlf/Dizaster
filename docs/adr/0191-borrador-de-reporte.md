# ADR 0191 — Borrador de reporte en el teléfono y limpieza de media huérfana

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.4 define `ReportDraft`. Un reporte a medio escribir vivía solo en memoria: si el sistema cerraba la app (llamada,
poca memoria, Android matando la actividad mientras la cámara está abierta) se perdía el texto y las fotos. Además,
las copias en `pending-media` de un reporte abandonado nunca se borraban.

## Decisión

- `lib/report/draft.ts` (lógica pura, probada) y `draft-store.ts` (SQLite, tabla `report_draft` de una fila).
  El borrador guarda categoría, texto, seudónimo, medios locales y evento elegido. **Nunca la ubicación**: al
  retomarlo se vuelve a pedir el GPS, porque la presencia debe ser de ahora.
- Guardado automático 0,5 s después de cada cambio en la pantalla de redactar; al enviar se borra sin tocar las
  fotos (pasan a la cola); al descartar se borra con sus fotos. Caduca a las 24 h.
- Al abrir "Reportar" con un borrador vigente se ofrece Continuar o Descartar. Elegir otra categoría lo descarta.
- Android: antes de abrir la cámara se anota en el borrador qué se estaba capturando; si la app murió, al retomar
  se recupera la foto con `getPendingResultAsync` y se procesa igual (re-codificación, sin Exif). `source` sale de
  lo anotado, nunca del resultado (integridad de "capturado en la app", D-10). En iOS no aplica.
- Al arrancar con sesión se borran de `pending-media` los archivos que no están ni en la cola ni en el borrador y
  tienen más de una hora (no se toca una captura en curso).
- Los contra-reportes ("aquí no pasa nada") no usan borrador.

## Consecuencias

- Mismo comportamiento en Android e iOS salvo la recuperación de la cámara (solo Android la necesita).
- Prueba: `apps/mobile/test/report-draft.test.ts`.
