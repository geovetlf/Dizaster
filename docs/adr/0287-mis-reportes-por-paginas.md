# ADR 0287 — "Mis reportes" por páginas

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: §6.3 (paginación por cursor), §13.1 (paginación obligatoria); ADR 0094, 0106
- IA: no. Costo: 0.

## Contexto

`GET /v1/me/reports` devolvía como máximo los 200 reportes más recientes, sin cursor. Quien tuviera más no podía ver,
retirar ni responder "¿Es el mismo evento?" en los anteriores desde la app.

## Decisión

1. `GET /v1/me/reports` acepta `cursor` (id del último reporte recibido) y `limit` (1 a 200, 50 por defecto). Responde
   `{ reports, nextCursor }` de lo más reciente a lo más antiguo, comparando por `(received_at, id)` como en ADR 0106.
2. El cursor tiene que ser un reporte propio. El de otra persona se rechaza como inválido, así no sirve ni para
   saber su fecha.
3. La app pide la página siguiente al llegar al final de la lista y une las páginas sin repetir (`appendPage`).

## Fuera de esta decisión

El historial de avisos de moderación (`/v1/me/moderation`) sigue limitado a los 50 más recientes. Cada aviso se
puede abrir por su id.
