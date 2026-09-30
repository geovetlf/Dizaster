# ADR 0204 — Logs de peticiones sin coordenadas ni IP

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.2 y RNF-04 (minimización), y ADR 0142 (no usar la IP). Las trazas ya quitaban el query string, pero el log de
peticiones de Fastify guardaba la URL completa y la IP del cliente. La app llama a `/v1/events/nearby?lat=…&lng=…`
con la posición del teléfono a 6 decimales; las cajas del mapa y `/v1/geo/country` también llevan coordenadas.
Esos logs se guardan y rotan fuera de la base de datos, sin la retención ni los controles de la ubicación precisa.

## Decisión

- `src/http/log.ts`: serializador propio de la petición que registra solo método, ruta e id de correlación. El query
  string se sustituye por `?[REDACTED]` (se ve que lo había, no su contenido). Sin IP ni puerto.
- Se redactan además `authorization`, `cookie` y `x-forwarded-for` por si algún día se registrara la petición completa.
- La IP sigue usándose en memoria solo para el límite de peticiones sin sesión (ADR 0047), nunca se guarda.

## Consecuencias

- Para depurar se usa el id de correlación (ADR 0172), no la URL completa.
- Prueba `request-log.test.ts`: una petición real con coordenadas e IP no deja ninguna de las dos en el log.
