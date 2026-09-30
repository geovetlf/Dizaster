# ADR 0269 — Purga diaria de sesiones caducadas

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §13.2 (minimización), §7.4; ADR 0021, 0029, 0210
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Cada renovación del refresh token crea una fila en `identity.sessions` y marca la anterior como rotada (ADR 0021).
Nada las borraba: la tabla crecía con cada apertura de la app y la exportación de datos acumulaba filas sin uso.

## Decisión

- `IdentityService.purgeExpiredSessions`, dentro de `retention.identity` (job diario de mantenimiento), borra por
  lotes (5 000, hasta 20 por ejecución) las filas con `expires_at` pasado. Un token caducado se rechaza antes de mirar
  si fue rotado, así que su fila ya no sirve ni para detectar reutilización.
- Se conservan: las filas vigentes; las rotadas o revocadas que no han caducado (delatan el uso de un token robado); y
  la primera fila de cada inicio de sesión que sigue abierto, que da `startedAt` en la lista de sesiones (ADR 0029).
- Migración `0103_sessions_expiry_index.sql`: índice por `expires_at`.

## Consecuencias

- La tabla queda acotada a unos 60 días de renovaciones por dispositivo más una fila por sesión abierta.
