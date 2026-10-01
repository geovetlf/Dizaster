# ADR 0289 — "Mis avisos de moderación" por páginas

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §6.3 (paginación por cursor), §13.1 (paginación obligatoria), §13.3 (apelaciones); ADR 0106, 0236, 0287
- IA: no. Costo: 0.

## Contexto

`GET /v1/me/moderation` devolvía como máximo las 50 acciones más recientes sobre el contenido o la cuenta de la
persona, sin cursor. Apelar una acción anterior seguía funcionando por su id (ADR 0236), pero la persona ya no podía
verla en la app ni saber por qué se tomó.

## Decisión

1. `GET /v1/me/moderation` acepta `cursor` (id de la última acción de la página anterior) y `limit` (1 a 200, 50 por
   defecto). Responde `{ notices, nextCursor }` de lo más reciente a lo más antiguo, comparando por `(created_at, id)`
   como en ADR 0106 y 0287. El índice `actions_affected_idx (affected_user_id, created_at DESC)` ya cubre la consulta.
2. El cursor tiene que ser una acción que afecte a quien pregunta. El de otra persona se rechaza como inválido, así no
   sirve ni para saber la fecha de su acción.
3. La app pide la página siguiente al llegar al final de la lista y une las páginas sin repetir avisos
   (`appendNotices`), de modo que un aviso recién apelado conserva su estado.
4. Apelar sigue resolviendo la acción por id, sin depender de la página en la que esté.
