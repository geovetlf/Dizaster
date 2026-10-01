# ADR 0295 — Exportación sin recortes silenciosos

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §13.2 (derecho de exportación); ADR 0038, 0256, 0290
- IA: no. Costo: 0.

## Contexto

Cada lista de "Descargar mis datos" tenía un tope fijo por módulo (5000 o 10000 filas) y nada avisaba si se llegaba a
él: una persona con mucha actividad recibía una copia incompleta que parecía completa.

## Decisión

1. Un solo tope para todas las listas: `DATA_EXPORT_ROW_LIMIT` (10 000) en `@dizaster/contracts`. Las listas que antes
   tenían 5000 (avisos, medios, acciones de moderación, denuncias enviadas) suben a 10 000.
2. Cada módulo pide una fila de más. `capExportSections` recorta a 10 000 y nombra en `truncated` las listas que
   tenían más (por ejemplo `"social.reactions"`). Sin recortes, `truncated` es una lista vacía.
3. La app avisa al descargar si la copia está recortada; el archivo dice cuáles listas.
4. El tope se mantiene: la exportación se arma en memoria en una sola respuesta y está limitada a una por minuto
   (ADR 0290). Exportar por partes queda para cuando haya cuentas reales que lleguen al tope.
