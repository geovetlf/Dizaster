# ADR 0208 — Tope de bloqueos y lista acotada

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.1 pide que ninguna lista crezca sin límite. `GET /v1/me/blocks` devolvía todos los bloqueos sin `LIMIT`, y los
bloqueos (personas y negocios) no tenían máximo. Los seguimientos sí lo tienen (2000). Además, el feed filtra por
bloqueos en cada lectura, así que una lista enorme encarece cada petición del feed de esa persona. La galería del
evento ya va por páginas (ADR 0203).

## Decisión

- `MAX_BLOCKS = 2000`, igual que los seguimientos, contando personas y negocios juntos. Bloquear a alguien nuevo con
  el tope alcanzado da 409 `LIMIT_REACHED`, que la app ya traduce. Volver a bloquear a alguien ya bloqueado, o
  desbloquear, funciona siempre.
- `GET /v1/me/blocks` lleva `LIMIT MAX_BLOCKS`. Con el tope, la respuesta queda acotada (unos 40 KB en el peor caso),
  así que no hace falta cursor, igual que con la lista de seguidos.

## Consecuencias

- Se evita que una cuenta con miles de bloqueos degrade su propio feed y la base de datos.
- Prueba `block-limit.test.ts`.
