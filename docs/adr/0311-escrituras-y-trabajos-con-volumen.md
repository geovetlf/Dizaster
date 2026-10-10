# ADR 0311 — Camino de un reporte y trabajos de mantenimiento con volumen

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §5.22 (rendimiento en picos), §13.2 (retención y privacidad); ADR 0243, 0249, 0309, 0310
- IA: **NO AI REQUIRED**. Costo: 0 (cinco índices; sin servicios nuevos).

## Contexto

ADR 0309 y 0310 cubrieron las lecturas. En un desastre, lo que más pesa es el camino de cada reporte:
- el cupo por cuenta y por teléfono;
- la coincidencia con eventos;
- la verificación;
- las alertas a zonas, suscripciones y personas cercanas;
- el envío de avisos;
- el feed.

A eso se suman los trabajos de cada hora y de cada día.

El método es el mismo, con un cambio: `scansDuring` (en `test/query-plans.ts`) también revisa los `UPDATE`, `DELETE`
e `INSERT … SELECT`. `EXPLAIN` sin `ANALYZE` no los ejecuta.

Volumen, con proporciones de producción:
- 20 000 eventos por todo Perú, el 5 % en Lima. Solo el 15 % está activo o en seguimiento; el resto está resuelto o
  archivado.
- 40 000 reportes de otras personas, con presencia (generalizada pasados 7 días), evidencia, post y aporte de
  reputación.
- 20 000 zonas, suscripciones y ubicaciones aproximadas.
- 60 000 avisos, uno de cada mil pendiente de envío.

Se revisó todo lo que lanzan dos reportes del mismo evento, más 13 trabajos de mantenimiento.

| Dónde | Problema |
| --- | --- |
| Cada reporte: cupo por teléfono | `report.reports` por `device_id` (hora, día y 30 días de señales de manipulación) sin índice |
| Cada evento con avisos: fusiones heredadas | `event.events` por `merged_into_id` (consulta recursiva) sin índice |
| Cifrado diario de ubicaciones antiguas en claro | `device_fix IS NOT NULL` sin índice: recorría toda la presencia aunque no quedara ninguna |
| Retención diaria de ubicaciones aproximadas | `alert.last_locations` por `seen_at` sin índice |
| Retención diaria de avisos | `alert.notifications` por `created_at` (los ya entregados) sin índice. Es la tabla que más crece |

## Decisión

Migración 0107, con cinco índices. Dos son parciales, para no pesar en las escrituras:
- `report.reports (device_id, received_at DESC) WHERE device_id IS NOT NULL`;
- `event.events (merged_into_id) WHERE merged_into_id IS NOT NULL`;
- `report.presence_evidence (report_id) WHERE device_fix IS NOT NULL` (casi siempre vacío);
- `alert.last_locations (seen_at)`;
- `alert.notifications (created_at) WHERE status <> 'PENDING'`, con el mismo predicado que la retención.

Ninguna consulta cambia. El cupo, la privacidad, la retención y el orden de envío quedan iguales.

`services/core/test/volume-write-plans.test.ts` mantiene el volumen y falla si el camino del reporte o alguno de los
13 trabajos recorre entera una tabla grande.

## Resultado (misma máquina, mismo volumen, una pasada)

| Qué | Antes | Después |
| --- | --- | --- |
| Dos reportes del mismo evento, con verificación, alertas y envío | 185 ms | 123 ms |
| Retención de avisos y ubicaciones | 14,2 ms | 1,7 ms |
| Cifrado de ubicaciones antiguas | 10,5 ms | 0,7 ms |
| Resto de trabajos | igual, dentro del ruido | |

Sin la migración, la prueba falla en esos tres puntos.

## Consecuencias y límites

- `events.lifecycle` y `events.archive` tardan 1–2 s en esta prueba. No es por los planes: en la primera pasada
  cambian de estado miles de eventos con su timeline y su outbox. En marcha normal, cada hora mueve solo lo que
  venció en esa hora.
- El envío de avisos con una cola pendiente grande, frente a pocos avisos, puede recorrer `alert.alerts`. A ese
  tamaño el plan es correcto. Con la proporción real, una cola corta frente a todos los avisos, usa índices.
- Los tiempos son locales. La latencia real se mide en staging (D-18, D-23).
