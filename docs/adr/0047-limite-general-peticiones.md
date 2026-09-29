# ADR 0047 — Límite general de peticiones

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §13.1 ("rate limits en el borde y en la API"), §12

## Decisión
- Límite por ventana fija de un minuto, en memoria, para todo `/v1/*`: por cuenta si hay sesión y por IP si no.
  Por defecto 300 peticiones/min y 60 escrituras/min (`RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_WRITES_PER_MINUTE`).
  Al pasarse: 429 `RATE_LIMITED` con `retry-after` y la métrica `http.rate_limited`.
- Por cuenta y no por IP cuando hay sesión: en un desastre mucha gente comparte la IP de un wifi o de la red móvil
  (CGNAT) y no debe bloquearse entre sí; y cambiar de IP no da más cupo a un abusador.
- `TRUST_PROXY=true` solo detrás de un CDN o balanceador que fije `X-Forwarded-For`; si no, la IP sería falsificable.
- Se suman a los cupos por función que ya existían (reportes, subidas, publicaciones, denuncias, exportación).
- `/health` no cuenta.

## Consecuencias
- Con varias instancias cada una limita por su cuenta; al escalar (etapa 1 de §14) pasa a Redis sin cambiar la
  interfaz. El WAF del CDN sigue siendo la primera línea cuando exista (requiere cuenta cloud).
