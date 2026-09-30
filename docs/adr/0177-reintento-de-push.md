# ADR 0177 — Reintento de avisos push con error temporal

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.22 fija el SLO "alerta oficial URGENT entregada < 2 min". Un 429, un 5xx o una caída de red de APNs/FCM dejaba
la notificación en FAILED para siempre: una confirmación oficial grave podía perderse por un corte de segundos.

## Decisión

- `PushResult.retryable`: 429, 5xx y errores de red (sin respuesta) son temporales; 4xx y tokens inválidos, no.
  Un proveedor no configurado no se reintenta.
- Migración 0084: `alert.notifications.attempts` y `next_attempt_at`. Si ningún dispositivo aceptó y alguno falló
  por algo temporal, la notificación vuelve a PENDING con espera 15 s, 30 s y 60 s (`PUSH_MAX_RETRIES = 3`, cabe en
  los 2 minutos). Agotados, FAILED. La entrega solo toma lo pendiente cuya espera ya venció.
- Cada reintento pasa otra vez por las reglas de entrega: vencimiento de la alerta (ADR 0174), horas de silencio y
  límite por hora (las críticas nunca se silencian).

## Consecuencias

- Un token inválido se sigue olvidando al instante; un fallo definitivo sigue siendo FAILED sin reintentos.
