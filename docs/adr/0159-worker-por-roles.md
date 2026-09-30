# ADR 0159 — Worker por roles: lo urgente aislado de lo normal

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (V1 sigue siendo un solo proceso)

## Contexto

§4.2 y §9.2 piden workers urgentes que el carril normal nunca bloquee. El worker era un único bucle en serie:
outbox, avisos, `tick()` de ingesta (todas las fuentes debidas, una tras otra, hasta 15 s cada una) y tareas
horarias y diarias. Un sondeo normal lento o una retención diaria larga retrasaban la entrega de un aviso.

## Decisión

- Tres roles, cada uno en su bucle: **urgent** (carriles `urgent` e `interactive` del outbox, entrega de avisos,
  publicación diferida, ingesta URGENT mirada cada 5 s), **normal** (carriles `normal` y `batch`, ingesta NORMAL
  cada 30 s) y **maintenance** (alertas operativas, tareas horarias y diarias). El volcado del medidor de uso corre
  en todos los procesos.
- `IngestionScheduler.tick(lanes)` sondea solo los carriles pedidos.
- `WORKER_ROLES` (por defecto `urgent,normal,maintenance`) elige los roles del proceso: en V1 un proceso con todos;
  para escalar, procesos separados por rol sin cambiar código. Outbox y avisos ya usan SKIP LOCKED.
- Un error en una vuelta se registra y el bucle sigue; ya no tumba todo el worker.
