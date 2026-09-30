# ADR 0158 — Cola de reportes offline sin pérdidas y con reintento automático

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.3 y C-04: en un desastre la red cae justo cuando la gente reporta. La cola (ADR 0010) contaba cada intento sin
red como un fallo y, tras 20, borraba el reporte y sus fotos; un 4xx (incluido un 401 por sesión vencida) lo borraba
al instante, y nadie se enteraba. Solo se reintentaba al abrir la app o al volver a primer plano.

## Decisión

- Estar sin red (sin respuesta del servidor) no gasta intentos: se reintenta indefinidamente.
- 401 es reintentable (el reporte espera al nuevo inicio de sesión). Errores con red (5xx, 429) cuentan intentos.
- Un error definitivo o el máximo de intentos con red DETIENE el reporte: queda en el teléfono con su media y el motivo.
  Nunca se borra solo. En "Mis reportes" aparece "Sin enviar todavía" con su estado (esperando conexión,
  reintentando, detenido) y las acciones Reintentar y Descartar (con confirmación; solo entonces se borran las copias).
- Con la app abierta y algo en cola, reintento automático con espera creciente 15 s → 30 s → … → 5 min; se reinicia
  al volver a primer plano. Sin módulos nativos nuevos (Android e iOS iguales).
- Pendiente (necesita build de desarrollo, bloqueado por EXPO_TOKEN): reintento en segundo plano con la app cerrada.
