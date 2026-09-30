# ADR 0182 — Particionado mensual preparado para eventos y reportes

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (no se activa)

## Contexto

§7.4: "`event` y `report` particionadas por mes cuando el volumen lo requiera (el esquema lo permite desde el inicio:
clave de partición incluida en la PK)". Faltaba comprobar que de verdad se puede sin reescribir el modelo.

## Decisión

- Clave de partición = `id`. Todos los ids son UUIDv7 generados en el servidor: sus 48 primeros bits son el
  instante de creación, así que `PARTITION BY RANGE (id)` con límites mensuales parte por mes **con la PK actual**.
- `platform/partitioning.ts`: `uuidV7Floor(fecha)`, `monthPartitions(desde, meses)` y `monthPartitionDdl(tabla, mes)`.
- Prueba automática: copia `event.events` y `report.reports` (columnas generadas incluidas) en tablas partidas por
  mes, mete los datos reales y comprueba que caen en su mes.
- Único obstáculo encontrado: `report.reports UNIQUE (author_user_id, client_report_id)` (idempotencia) no incluye
  `id`, y PostgreSQL no admite únicas así en una tabla partida. Al partir, ese par pasa a una tabla pequeña
  `report.client_report_ids (author_user_id, client_report_id) PRIMARY KEY → report_id`, sin partir.

## Cuándo y cómo (runbook)

Solo cuando el volumen lo pida (p. ej. `event.events` o `report.reports` por encima de decenas de millones de filas o
vacuum/índices lentos). Pasos, en ventana de mantenimiento y con copia de seguridad: crear las tablas partidas y las
particiones de los meses con datos más dos futuros; crear la tabla de idempotencia; copiar por lotes; cambiar nombres
en una transacción; recrear las FK que apuntan a ellas (PostgreSQL 16 las admite hacia tablas partidas); programar la
creación mensual de la partición siguiente en el worker.

## Consecuencias

- Hoy no cambia nada en producción; no hay migración. Activarlo es una decisión de operación, con este runbook.
