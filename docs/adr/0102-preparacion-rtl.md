# ADR 0102 — Preparación para idiomas de derecha a izquierda (RTL)

- Estado: aceptada (2026-09-29).
- Blueprint: §5.15 (internacionalización; RTL preparado desde el diseño)
- IA: **NO AI REQUIRED**. Costo: 0. Sin paquetes nuevos.

## Contexto

V1 se publica en español, inglés, portugués y francés, pero la arquitectura es global. Nada preparaba la app para
árabe, hebreo o persa. Además, un teléfono configurado en un idioma RTL podía mostrar espejada la app aunque esta
estuviera en español.

## Decisión

- **Dirección según el idioma de la app.** `applyDirection` fija `I18nManager.allowRTL`/`forceRTL` al aplicar el
  idioma, según el de la app y no el del teléfono.
  - React Native fija la dirección al arrancar: un cambio vale desde el próximo inicio.
  - Con los cuatro idiomas actuales siempre es LTR. Un teléfono en árabe con la app en español vuelve a verse
    normal tras reiniciar.
- **Lista de idiomas RTL.** `isRtlLang` reconoce los idiomas RTL comunes (ar, he, fa, ur y otros) por su código base.
  Sumar uno es agregar su catálogo; el diseño ya responde.
- **Estilos lógicos.** Los márgenes y posiciones que dependen del lado pasan a `start`/`end` (`marginStart`,
  `end: 8`…): insignias, duración de videos, botones del mapa, respuestas anidadas.
  - Quedan físicos a propósito: los recuadros de difuminado, que son coordenadas de la imagen, y los márgenes que
    pide la API del mapa.
- **Iconos de avance.** `forwardChevron` elige el icono de "abrir" de las filas para que apunte al final de la
  línea.
- **Guardia.** Una prueba falla si algún componente vuelve a usar `marginLeft/Right` o `paddingLeft/Right`.

## Consecuencias

- Agregar un idioma RTL es agregar su catálogo de textos y revisar la app en ese idioma, sin rehacer estilos.
- Pruebas: `apps/mobile/test/direction.test.ts`.
