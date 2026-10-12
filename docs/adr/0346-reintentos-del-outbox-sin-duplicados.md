# ADR 0346 — Reintentos y workers simultáneos del outbox sin duplicados

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §4.2 (outbox); ADR 0130, 0177, 0206
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

El outbox procesa cada evento en una transacción:
- toma el evento con `FOR UPDATE SKIP LOCKED`;
- registra el consumo en `outbox_consumption` en esa misma transacción;
- si un consumidor falla, vuelve atrás todo el trabajo de ese evento (`SAVEPOINT`) y lo reintenta con espera.

Nada probaba lo que eso promete: que un evento reintentado o procesado por varios workers no duplica avisos,
alertas ni evidencias.

## Decisión

`services/core/test/idempotency-dispatcher.test.ts`:
- **Fallos transitorios con cuatro workers.** Un consumidor de prueba falla la primera vez en cada evento de los tipos
  que generan avisos y evidencia. Cuatro workers procesan a la vez. La huella final es idéntica a la de un escenario
  igual procesado por un worker sin fallos:
  - avisos por persona y motivo;
  - evidencia;
  - línea de tiempo;
  - alertas;
  - estado de verificación;
  - contribuciones.
  No queda nada en cuarentena ni pendiente.
- **Reentrega completa.** El peor caso de «al menos una vez»: todo el outbox vuelve a la cola sin registro de
  consumo. No cambia el recuento de alertas, avisos, estado de alertas, evidencia, candidatos a duplicado, estado y
  transiciones de verificación, trabajos de IA, contribuciones, resultados, sanciones, casos, acciones, posts ni
  seguimientos.
- **Envíos de push simultáneos.** Cuatro `flush` a la vez mandan cada aviso una sola vez y no dejan nada pendiente.

No hizo falta cambiar código: la combinación de registro de consumo, `dedup_key` único en `alert.alerts` y
`(profile_id, alert_id)` único en `alert.notifications` ya lo garantiza.

## Consecuencias

- Hallazgo menor: `event.mirror-verification` añade una entrada `VERIFICATION_CHANGED` a la línea de tiempo en cada
  ejecución. Solo lo protege el registro de consumo, que va en la misma transacción, así que en la práctica no se
  repite. Si algún día se reentregan eventos a mano sin ese registro, la línea de tiempo pública mostraría el cambio
  dos veces. Se deja documentado y fuera de la prueba de reentrega.
