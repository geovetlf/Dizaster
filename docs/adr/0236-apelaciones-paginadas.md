# ADR 0236 — Apelaciones paginadas y buscadas por id

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

La lista de apelaciones devolvía como máximo 50, siempre las más antiguas. Decidir una apelación releía esa lista
para devolverla: pasadas 50 decididas, la respuesta salía vacía. Apelar buscaba la acción entre las 50 más
recientes de la persona: una acción apelable (dentro de 30 días) pero más antigua daba 404.

## Decisión

- `GET /v1/moderation/appeals?status=&cursor=&limit≤100` devuelve `{ appeals, nextCursor }`. Abiertas: más antiguas
  primero (es una cola). Decididas: más recientes primero. Cursor = id de la última (UUIDv7).
- Decidir devuelve la apelación leída por su id. Apelar consulta la acción por id y persona afectada.
- La app carga más apelaciones al llegar al final de la lista.

## Consecuencias

- Ninguna apelación queda fuera de alcance. Prueba en `appeals-pagination.test.ts`.
