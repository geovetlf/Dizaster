# ADR 0342 — Respuestas de la API validadas en estricto contra el contrato

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §4.3 (contratos); ADR 0052 (OpenAPI desde zod)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

`@dizaster/contracts` valida en el servidor lo que **entra** (cuerpos y query), pero casi todo lo que **sale** estaba
declarado como `interface` de TypeScript. TypeScript no impide un campo de más (un `...row` o un `as`) ni comprueba la
respuesta real. Solo 13 rutas tenían esquema de respuesta en OpenAPI, y una estaba mal: `GET /v1/events/:id`
declaraba `EventSummary` y la ruta además envía `mergedIntoId`, `publicationState` y `affectedArea`.
`GET /v1/events/:id/posts` documentaba `FeedQuery` cuando la ruta lee `ProfilePostsQuery`.

## Decisión

- **Esquemas espejo** (`packages/contracts/src/response-schemas.ts`). Cada interfaz de respuesta principal tiene un
  esquema zod: feed y post (también el SHARE anidado, recursivo), comentarios, reacciones, perfiles, mi perfil,
  seguimientos, etiquetas, mis reportes, avisos, zonas, suscripciones, sesiones y políticas.
  - La interfaz sigue tipando la app. No cambia ningún tipo de la app.
  - Cada esquema se comprueba **en compilación** contra su interfaz, en los dos sentidos (`sameAs<T>()`). Un campo
    de más, uno de menos o un cambio de opcionalidad rompe el `typecheck`. Se comprobó a mano con tres mutaciones.
- `EventDetail` y `AffectedAreaView` pasan a ser zod (`EventSummary.extend`). El tipo inferido es el mismo que antes.
- **Prueba de contrato** (`services/core/test/contract-responses.test.ts`).
  - Crea datos reales por la API: reportes, evento, post, compartido, seudónimo, mención, comentario, reacciones,
    seguimientos, zona, suscripción.
  - Recorre las rutas principales sin sesión, con sesión de la autora y con sesión de otra persona.
  - Valida cada respuesta con su esquema en modo **estricto profundo** (`deepStrict`). Todo objeto anidado rechaza
    claves no declaradas, también en uniones, registros parciales y el post recursivo.
  - La propia prueba comprueba que el modo estricto detecta un campo de más anidado, uno que falta y una clave de
    enum desconocida.
- OpenAPI documenta esas respuestas con el mismo esquema (23 rutas más) y corrige las dos entradas erróneas.

## Pruebas

- `contract-responses.test.ts`: 9 casos, todos en verde.
- Resultado: el backend ya emitía exactamente lo declarado. El único desajuste fue el contrato documentado de
  `GET /v1/events/:id` (corregido). No sale por la API ningún campo no declarado: ni `userId`, ni el `id` interno del
  perfil, ni la ubicación del reportero.

## Consecuencias

- Una respuesta que gane un campo sin declararlo en el contrato hace fallar la prueba. El campo se declara primero,
  y si es nuevo, opcional (ADR 0343).
- Quedan sin esquema espejo las respuestas de administración y moderación (siguen como interfaces). Es el siguiente
  paso si se quiere la misma garantía allí.
