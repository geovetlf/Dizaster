# ADR 0091 — Detección local del idioma del contenido

- Estado: aceptada (2026-09-29)
- Blueprint: §5.15 ("detección de idioma del contenido con un modelo ligero local, sin costo por llamada")
- IA: **NO AI REQUIRED**. Costo: 0. Sin paquetes nuevos.

## Contexto

`social.posts.lang` existía pero nunca se llenaba. Saber el idioma de un texto es la base para ofrecer traducción
más adelante (conector opcional, apagado) y, desde ya, para avisar que un post está en otro idioma.

## Decisión

- `detectLanguage(text)` en `@dizaster/contracts`, compartido entre la app y el servidor. Es determinista:
  - puntúa palabras vacías muy frecuentes y rasgos ortográficos de es/en/pt/fr (ñ y ¿¡; ã/õ y -ção; è/ê/œ y
    elisiones; -ing);
  - ignora enlaces, #etiquetas y @menciones;
  - devuelve null con menos de 3 palabras o sin un ganador claro (≥ 2 puntos y 30 % sobre el segundo).
- El servidor guarda el idioma al crear el post y lo expone en `FeedPost.lang`.
- La app muestra "Escrito en English" cuando el idioma detectado difiere del de la interfaz.
- Los posts anteriores quedan sin idioma: no se recalculan en lote, porque null también es un resultado válido y
  el recálculo se repetiría sin fin.
- Añadir idiomas es añadir listas de palabras y rasgos; si algún día hiciera falta más precisión, un modelo local
  (p. ej. n-gramas) puede reemplazar la función sin cambiar el contrato.

## Consecuencias

- Pruebas: `packages/contracts/test/language-detect.test.ts`, `services/core/test/post-lang.test.ts`,
  `apps/mobile/test/language.test.ts`.
