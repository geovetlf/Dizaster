# ADR 0291 — Cupo propio para búsquedas

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §13.1 (rate limiting, validación estricta), §12 (cost-first); ADR 0047, 0065, 0107, 0142, 0228
- IA: no. Costo: 0.

## Contexto

Las búsquedas por texto (`/v1/search/events`, `/v1/search/posts`, `/v1/profiles`, `/v1/businesses`, `/v1/tags`,
`/v1/geo/areas`) son las lecturas más caras de la API: varias consultas por petición, comparaciones de texto sin índice
propio y, en eventos, hasta los archivados. Son públicas como el mapa y solo las frenaba el límite general de 300
peticiones por minuto, el mismo que una lectura barata.

## Decisión

1. Las búsquedas tienen un cupo aparte, `SEARCH_RATE_LIMIT_PER_MINUTE` (120 por defecto), además del general. Al pasarlo
   la API responde 429 con `Retry-After`; la app ya traduce `RATE_LIMITED`.
2. La clave es la misma que la del límite general: la cuenta con sesión, la IP sin ella. Se cuenta en memoria de cada
   réplica, sin guardar IPs en la base (ADR 0142). Con varias réplicas, cada una aplica el cupo por su lado.
3. 120 sale de la app: tras 300 ms sin escribir lanza 6 búsquedas a la vez, así que alcanza para unas 20 búsquedas
   por minuto y por persona. Es configurable sin desplegar código.
4. Lo que no es búsqueda (mapa, feed, configuración, detalle de un evento) no gasta este cupo.

## Fuera de esta decisión

Un índice de trigramas para los títulos de eventos queda para cuando haya datos de uso reales que lo justifiquen.
