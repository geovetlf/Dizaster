# ADR 0003 — POST, REPORT y EVENT

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §7.1

## Decisión
- **POST** (`social.posts`): contenido social. No requiere presencia. Ubicación opcional y siempre ya generalizada.
- **REPORT** (`report.reports` + `report.presence_evidence`): afirmación ciudadana con presencia física calculada en el servidor. Tiene siempre un POST como cara social (`kind = REPORT`) enlazado al evento (`social.post_event_links`). Afirmación `OCCURRING` o `NOT_OCCURRING` (contra-reporte).
- **EVENT** (`event.events`): lo crea el sistema. Evidencias en `event.evidence` con su origen explícito (`CITIZEN`, `EXTERNAL`, `OFFICIAL`) — nunca se mezclan.
- Todo origen (ciudadano, oficial, open data, noticias, sensores futuros) se reduce a `EventCandidate` (`packages/contracts/src/event.ts`) y entra por `EventService.resolveCandidate`.

## Reglas implementadas
- Presencia LOW → el reporte se publica como POST sin pin (`DOWNGRADED_TO_POST`).
- Presencia MEDIUM → puede crear evento, pero queda `PENDING_CORROBORATION` (fuera del mapa) hasta que otra persona o fuente lo respalde.
- Sin atestación de integridad del dispositivo, la presencia máxima es MEDIUM.
- Offline fuera de la tolerancia de la categoría → testimonio tardío: solo se suma a un evento existente.
- Un contra-reporte nunca crea eventos y debe indicar el evento que niega.
- Deduplicación determinista (distancia, tiempo, compatibilidad de categoría, palabras clave) con bandas: adjuntar / ambiguo (se adjunta al mejor y se abre `event.dedup_reviews`) / nuevo. Serialización por celda H3 r5 para evitar duplicados simultáneos.
