# ADR 0127 — Runbooks de operación e incidentes

Estado: aceptada (2026-09-29)

## Contexto
§13.1 pide un plan de respuesta a incidentes y §18 una carpeta `docs/runbooks/`. Las herramientas existían
(kill switches, circuit breaker, respaldos, rotación de claves, revocación por reutilización de tokens), pero no el
procedimiento, y pausar una fuente solo se podía desde código.

## Decisión
- `docs/runbooks/`: respuesta a incidentes (gravedad, roles, primeros 15 minutos), fuente caída o con datos
  erróneos, presupuesto y kill switches, outbox atascado, respaldo y restauración, rotación de claves y sesiones
  comprometidas. Cada uno cita las consultas y comandos reales y los ADR de origen.
- CLI `source-status` (`pnpm source-status <clave> ACTIVE|PAUSED|…`): pausar o reactivar una fuente sin desplegar.
  Pausar no borra lo ingerido.
- Reglas comunes: primero las personas, luego disponibilidad, luego costo; nada destructivo sin dos personas; los
  registros de auditoría no se editan (ADR 0113).

## Pendiente de infraestructura (propietario)
Destino cifrado de los respaldos, versionado del bucket de media y vigilancia externa del worker (ADR 0058).
