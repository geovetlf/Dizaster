# ADR 0290 — Espera entre exportaciones compartida entre réplicas y acotada

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §13.1 (rate limiting), §13.2 (derecho de exportación), §12 (cost-first); ADR 0038, 0047, 0228
- IA: no. Costo: 0.

## Contexto

`GET /v1/me/export` ejecuta varias consultas de hasta 5000 filas por módulo. Se limitaba a una por minuto y persona con
un `Map` en memoria de cada instancia: con varias réplicas cada una tenía su propia cuenta, y el `Map` nunca se
vaciaba, así que crecía con cada persona que había exportado alguna vez.

## Decisión

1. La espera se guarda en PostgreSQL, en la tabla `UNLOGGED platform.account_cooldowns (user_id, kind, until)`: una fila
   por cuenta y acción con la hora en que vuelve a estar permitida. La clave es el id interno de la cuenta, nunca una IP
   (ADR 0142). Perder la tabla en un reinicio solo permite repetir antes de tiempo.
2. `AccountCooldown.take` reserva la acción con un `INSERT … ON CONFLICT DO NOTHING`, así dos réplicas no pueden
   exportar a la vez para la misma persona. Si ya está reservada, la API responde 429 con `Retry-After`.
3. Las filas vencidas se borran al volver a intentar la acción y en la limpieza diaria (`retention.cooldowns`). La
   memoria del proceso ya no crece con el número de personas.
4. Se usa siempre, con una réplica o con varias: es una consulta pequeña en una acción rara.
