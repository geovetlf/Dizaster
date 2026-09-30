# ADR 0229 — Los tokens inválidos gastan el cupo de la IP

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

La sesión se verifica antes del límite general (ADR 0047). Un token falso respondía 401 sin contar, así que una
ráfaga de tokens inválidos no tenía límite y consumía CPU en la verificación.

## Decisión

- Si el token no es válido, la petición cuenta en el cupo en memoria de su IP. Pasado el cupo, se responde 429 con
  `Retry-After` en vez de 401. La IP no se guarda en ningún sitio (solo el contador en memoria de un minuto).

## Consecuencias

- Las ráfagas con tokens falsos quedan acotadas igual que las anónimas.
- Prueba en `rate-limit.test.ts`.
