# ADR 0105 — Errores del servidor traducidos por código

Estado: aceptada (2026-09-29)

## Contexto
§5.15 del Blueprint pide que la app hable el idioma de la persona. El servidor responde los errores como
`{ error: CODE, message }` con el mensaje en español; la app mostraba ese mensaje en cualquier idioma.

## Decisión
- `apps/mobile/src/lib/errors/server-error.ts`: `SERVER_ERROR_KEYS` mapea los códigos que una persona puede ver
  (límite, cuota, permisos, sesión, validación, cuenta suspendida, edad, función pausada, MFA, conflicto, interno…)
  a claves i18n. `serverErrorMessage(body, status, lang, t)`:
  1. en español, el mensaje del servidor (es el más preciso, p. ej. "Puedes administrar hasta 3 negocios");
  2. en otro idioma, la traducción del código;
  3. código desconocido: el mensaje del servidor; sin mensaje, 429 → "demasiados intentos", 5xx → "falló el
     servidor", y si no `HTTP <status>`.
- `api.ts` construye el `Error` con ese texto; `status` y `body` siguen adjuntos para la lógica que decide por código.
- El servidor no cambia: el código ya es el contrato estable. NO AI REQUIRED.

## Consecuencias
- Un código nuevo se traduce añadiéndolo al mapa y al catálogo; un test comprueba que todas las claves existen.
- Los detalles numéricos del mensaje español se pierden en otros idiomas (se muestra el texto genérico del código).
