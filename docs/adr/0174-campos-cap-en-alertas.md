# ADR 0174 — Campos CAP en las alertas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

El modelo de datos del Blueprint (§7, entidad Alert) pide `origin (OFFICIAL, SYSTEM)`, `expires_at` y `cap_ref?`,
compatibles con CAP. `alert.alerts` no tenía ninguno: un aviso retenido por horas de silencio podía sonar cuando la
alerta oficial ya había vencido.

## Decisión

- Migración 0081: `alert.alerts.origin` (por defecto SYSTEM; lo ya existente pasa a OFFICIAL si estaba confirmado
  oficialmente o era una actualización institucional), `expires_at`, `cap_ref`; estado de notificación `EXPIRED`.
- `origin = OFFICIAL` solo si el evento está `OFFICIALLY_CONFIRMED` (que ya exige una fuente oficial registrada) o si
  es una actualización de su institución (ADR 0157). Todo lo demás, incluidas menciones y moderación, es SYSTEM.
- `IngestionService.officialAlertSource(eventId)`: la fuente oficial vigente más reciente del evento. Si su formato
  es CAP, `cap_ref = "<clave de fuente>:<identificador CAP>"`; su `expires` (ya guardado como `ends_at`) fija el
  vencimiento. Sin él, `ALERT_DEFAULT_TTL_HOURS` (24 por defecto). Menciones y moderación no vencen.
- Al entregar, lo que venció antes de salir pasa a `EXPIRED` y no suena, ni siquiera si era crítico: queda en el
  historial. La app muestra "Oficial" y "Vencida" en el historial y la nota "venció antes de enviarse".

## Consecuencias

- Sin fuentes oficiales activas en V1 (D-PTWC-2) todo sale como SYSTEM; el mecanismo queda listo.
- Exportar CAP de salida (§ integraciones de emergencia) sigue fuera de V1; estos campos son su base.
