# ADR 0156 — "¿Es el mismo evento?" tras un adjunto dudoso

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.4: en la franja ambigua (0,55 ≤ puntuación < 0,80, o varios candidatos cercanos) el reporte se adjunta como
"posible relación" y se pregunta a quien reportó "¿Es este el mismo evento?". El motor ya adjuntaba con
`match_confidence = AMBIGUOUS` y abría una `event.dedup_reviews`, pero nadie preguntaba.

## Decisión

- La respuesta de envío `ATTACHED_TO_EVENT` lleva `askSameEvent: true` cuando el adjunto fue ambiguo; "Mis
  reportes" expone `askSameEvent` mientras siga sin responder (reporte vigente, revisión abierta).
- `POST /v1/me/reports/:id/match` `{ answer: SAME | DIFFERENT }`, solo quien lo reportó, una vez (409 después).
  Migración 0071: `dedup_reviews.reporter_answer` y `answered_at`.
- SAME cierra la revisión como CONFIRMED. DIFFERENT queda anotado y la revisión sigue abierta, sin mover nada:
  qué hacer con un "No" (dividir o mandar a la cola de duplicados) es la decisión D2 del propietario, todavía
  pendiente. Cuando se decida, las respuestas ya guardadas podrán procesarse.
- App: tras enviar, un aviso con "Sí, es el mismo" / "No, es otro" / "No estoy seguro" (este último no envía nada y
  la pregunta queda en Mis reportes).
