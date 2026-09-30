# ADR 0197 — Todos los códigos de error del servidor traducidos

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.15 y ADR 0105: el servidor responde `{ error, message }` con el mensaje en español y la app traduce el código.
Solo 33 de 76 códigos tenían traducción; con los demás, quien usa la app en inglés, portugués o francés veía el
mensaje en español (p. ej. código de acceso incorrecto, apelación no admitida, foto aún en proceso).

## Decisión

- Los 76 códigos quedan en `SERVER_ERROR_KEYS`. 13 mensajes nuevos en es/en/pt/fr para los que ve la gente
  (código incorrecto, no apelable, media en proceso o sin subir, tipo no admitido, archivo ya usado, segundo factor,
  cuenta de acceso ya vinculada, método de acceso no disponible, acceso no verificado, nada que responder, conflicto
  de interés, último administrador). Los de uso interno o de personal usan los genéricos (conflicto, no encontrado,
  datos no válidos, sesión).
- `test/server-error-codes.test.ts` recorre el código del servidor (`new DomainError("…")` y `error: "…"`) y falla
  si aparece un código sin traducción: un código nuevo no puede llegar sin su mensaje.

## Consecuencias

- Ningún error del servidor se muestra en español a quien usa otro idioma.
