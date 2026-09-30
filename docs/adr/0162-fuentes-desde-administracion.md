# ADR 0162 — Salud de fuentes y pausa/reanudación desde la app de administración

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (lecturas de tablas propias)

## Contexto

§5.21 y §9.2 piden ver el estado de las fuentes y poder pausar una que falla o da datos malos sin desplegar. Hasta
ahora solo existía la CLI `source-status-cli` (ADR 0127) y el aviso `SourceHealthChanged` cuando se abre el breaker.

## Decisión

- `GET /v1/admin/sources` (permiso `ops.view`): por fuente, estado, salud (`sourceHealth` en contratos: IDLE si no
  está activa, DOWN con el breaker abierto, FAILING con fallos seguidos, OK, UNKNOWN sin ejecuciones), fallos
  seguidos, hasta cuándo sigue abierto el breaker, última ejecución y último éxito, ejecuciones OK/fallidas y
  elementos nuevos de las últimas 24 h, el último error (ya redactado al guardarse) y el último cambio de estado.
- `POST /v1/admin/sources/:key/status {to: ACTIVE|PAUSED, reason}` (permiso `ops.control`, es decir operación o
  administración, con MFA de personal): solo pausa una fuente activa o reanuda una pausada. Activar una fuente
  PLANNED/RESEARCH exige revisar términos y licencia, y sigue siendo del propietario por la CLI. Reanudar cierra el
  breaker y pone a cero los fallos, así la fuente se consulta en el siguiente ciclo. Cada cambio queda en
  `ingestion.source_status_log` (migración 0074) con quién, motivo y cuándo.
- Pausar no borra nada: lo ya ingerido sigue sosteniendo los eventos hasta que caduque. Sincronizar el registro de
  fuentes al desplegar no pisa el estado.
- App: pantalla "Fuentes de datos" en el perfil para `ops.view`; lo caído primero y las urgentes antes; motivo
  obligatorio y confirmación antes de pausar o reanudar.
