# ADR 0019 — Cost Optimization Layer persistido: presupuestos, kill switches y tablero de costo

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.18 y §12.2, ADR 0010 (reemplaza su `CostGuard` en memoria)

## Decisión
- **Módulo `cost`** (esquema `cost`) implementa la interfaz `CostGuard` (ahora asíncrona) de `platform/cost-guard.ts`.
  Los demás módulos solo conocen la interfaz: `check(key, usd)` antes de gastar, `record(key, usd)` después,
  `isKilled(feature)`.
- **Presupuestos** diarios o mensuales (UTC) por clave (`ai`, `sms`, `translation`...). Sin presupuesto, o con tope
  0, no se gasta. Al cruzar el 50, 80 y 100 % se publica `BudgetThresholdReached` por el outbox (carril urgente),
  una sola vez por umbral y periodo; al 100 % `check` deniega y la función se degrada a su alternativa gratuita.
- **Kill switches remotos** en base de datos (caché de 15 s por proceso): se apagan o encienden sin publicar versión
  de la app. `/v1/config` los expone a la app. IA, SMS y traducción empiezan apagados y con presupuesto 0.
- **Medición por módulo** (`platform/metrics.ts`, `Meter`): cada proceso acumula en memoria y vuelca cada minuto
  una fila por (día, módulo, métrica, proveedor) en `cost.usage_daily`. Medir no añade una escritura por petición.
  Se mide hoy: peticiones y bytes de respuesta por grupo de rutas, consultas geográficas (caché/índice), eventos del
  outbox, alertas por estado de entrega, mensajes push y ejecuciones de ingestión por fuente.
- **Precios de referencia como datos** (`data/cost/prices.json`, versionado): precio por unidad de cada métrica,
  almacenamiento por GB-mes y costes fijos (vacío hasta aprobar proveedor, D-18). Son estimaciones, no facturas.
- **Tablero** (rol admin): `GET /v1/admin/cost?days=N` con costo variable, almacenamiento (media + base de datos),
  fijo prorrateado, **costo por 1.000 usuarios activos**, detalle por módulo, serie diaria, presupuestos y kill
  switches. `PUT /v1/admin/cost/budgets/:key` y `PUT /v1/admin/kill-switches/:feature`. Sin panel web (V1 solo
  app): pantalla "Costos" en la app para cuentas admin y `pnpm cost:report` en la terminal. `pnpm grant-role`
  da el rol a una cuenta.
- **Usuarios activos** = cuentas con un dispositivo conectado en el periodo (`identity.devices.last_seen_at`).

## Consecuencias
- Coste propio: una tabla pequeña por día; retención de 400 días para comparar con el año anterior.
- Aprobar una función de pago es un cambio de datos (presupuesto + kill switch), auditado con quién lo hizo.
- Pendiente: avisar al propietario fuera del log cuando se cruza un umbral (push a administradores) y métricas de
  calidad del producto (tasa de duplicados, tiempo hasta verificación).
