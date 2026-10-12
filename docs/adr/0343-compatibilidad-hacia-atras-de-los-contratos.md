# ADR 0343 — Compatibilidad hacia atrás de los contratos con apps ya instaladas

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §4.3; ADR 0052, 0342; versión mínima de la app (`MIN_APP_VERSION_*`)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Una app instalada no se actualiza a la vez que el servidor. Hoy no hay versiones publicadas, así que nada se rompió
todavía. Pero nada impedía que un cambio de contrato rompiera a las apps del piloto:
- un campo obligatorio nuevo en un cuerpo;
- un campo de respuesta que desaparece;
- un valor de enum nuevo en un dataset que la app valida con zod en el teléfono. La app rechazaría el dataset entero
  y se quedaría con el empaquetado. Con los números de emergencia, ese fallo no se nota.

## Decisión

`packages/contracts/test/compat.test.ts` compara los esquemas actuales con `test/compat-baseline.json`, una línea
base generada de los propios esquemas: cada ruta de campo, si es obligatoria y sus valores de enum.

Rompe a una app instalada, y por tanto falla:
- **Peticiones** (`*Request`, `*Input`, `*Query`, `ClientCrashReport`):
  - un campo que pasa a ser obligatorio dentro de un objeto que ya existía;
  - un valor de enum que desaparece.
- **Respuestas** (las del contrato de ADR 0342): un campo obligatorio que desaparece o pasa a opcional.
- **Respuestas que la app valida con zod** (`CategoryCatalog`, `EmergencyNumbersResponse`, `EmergencyDataset`): un
  valor de enum nuevo.

No rompe y pasa:
- un campo opcional nuevo, aunque lleve obligatorios dentro;
- un campo de respuesta nuevo;
- un esquema nuevo.

Un cambio incompatible hecho a propósito exige:
1. un ADR;
2. subir la versión mínima de la app;
3. regenerar la línea base con `CONTRACT_BASELINE=update pnpm --filter @dizaster/contracts test`.

Además, un reporte, un post y un comentario con solo los campos de la primera versión siguen siendo válidos.

## Pruebas

`compat.test.ts`: la línea base actual (73 peticiones y 35 respuestas) no tiene cambios incompatibles. Un caso
sintético comprueba que se detectan los seis tipos de cambio incompatible y que lo compatible no falla.

## Consecuencias

- Añadir un `EmergencyService` o una `Sensitivity` nuevos hace fallar la prueba. Es intencional: antes hay que
  decidir cómo lo toman las apps viejas.
- La línea base no se regenera sola con los cambios compatibles. Un campo nuevo solo queda protegido contra su
  eliminación después de regenerarla.
