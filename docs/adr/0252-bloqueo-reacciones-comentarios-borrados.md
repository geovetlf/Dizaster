# ADR 0252 — Bloqueo en reacciones a comentarios y comentarios borrados sin texto

Fecha: 2026-09-30 · Estado: aceptada · NO AI REQUIRED

## Contexto
- El bloqueo (§13.3) impedía comentar, reaccionar a posts, compartir y seguir, pero no reaccionar a comentarios de quien bloqueó.
- Borrar un comentario propio lo marcaba `deleted_at` pero conservaba el texto (minimización, §13.2). El borrado de cuenta ya lo vaciaba.
- La auditoría propuso también quitar el aviso de mención en posts seudónimos. Se descarta: ADR 0063 ya decidió que se avisa con el texto neutro "Te mencionaron en una publicación", sin revelar al autor, y esa decisión sigue vigente.

## Decisión
- `PUT /v1/comments/:id/reactions/:kind` responde `BLOCKED` si el autor del comentario bloqueó a quien reacciona. Quitar una reacción sigue permitido.
- Borrar un comentario propio reemplaza su texto por `-`, igual que el borrado de cuenta.

## Consecuencias
- Pruebas en `test/block-enforcement.test.ts`.
