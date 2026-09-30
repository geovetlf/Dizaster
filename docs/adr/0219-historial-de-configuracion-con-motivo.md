# ADR 0219 — Historial inmutable y motivo obligatorio en cambios de configuración

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1 y §13.3 piden que las acciones de administración queden auditadas. Los roles del personal ya tenían motivo y
registro de solo inserción (ADR 0167), pero no el resto de la configuración: el sello de negocios e instituciones y
su ámbito oficial no guardaban quién los cambió, y presupuestos, kill switches y retrasos de publicación guardaban
solo el último valor, sin motivo (en los kill switches era opcional).

## Decisión

- Tabla `platform.config_changes` (migración 0093), de solo inserción por trigger: quién, cuándo, tipo
  (BUSINESS_VERIFICATION, OFFICIAL_SCOPE, BUDGET, KILL_SWITCH, PUBLISH_DELAY), objetivo, valor anterior, valor nuevo
  y motivo (mínimo 3 caracteres, también exigido por la base). Guarda solo campos de configuración.
- Las cinco rutas de administración exigen `reason` (`AdminReason` en contratos) y lo validan antes de cambiar nada.
  El retraso de publicación se cambia y audita en la misma transacción.
- `GET /v1/admin/config-changes` (solo administración): más reciente primero, filtro por tipo y paginado.
- App: campo de motivo en las pantallas de negocios, costos e interruptores y retrasos; los botones quedan
  deshabilitados sin motivo. Nueva pantalla "Historial de configuración".

## Consecuencias

- Todo cambio de configuración sensible es trazable y no se puede reescribir.
- Los cambios automáticos (degradación por costo, ADR 0138) no pasan por estas rutas y siguen marcados como
  automáticos en su propia tabla.
