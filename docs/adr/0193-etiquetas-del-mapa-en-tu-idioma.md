# ADR 0193 — Etiquetas del mapa en el idioma de la persona

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (mismas teselas; solo estilos JSON pequeños)

## Contexto

§6.1 define `MapProvider.styleUrl(theme, locale)`. El estilo propio se generaba en un solo idioma (español), así que
quien usa la app en inglés, portugués o francés veía las calles y ciudades en español.

## Decisión

- `infra/maps/make-style.mjs` genera `style-<esquema>-<idioma>.json` para es, en, pt y fr (y `style-<esquema>.json`
  en español por compatibilidad). Las teselas PMTiles son las mismas: OpenStreetMap ya trae `name:<idioma>` y el
  estilo elige la etiqueta, con el nombre local de respaldo.
- La URL del estilo en la config remota puede llevar `{lang}`. Contratos: `localizedStyleUrl(url, lang)` y
  `MAP_STYLE_LANGUAGES`; un idioma sin estilo usa español; sin `{lang}` no cambia nada (proveedores externos).
- La app aplica su idioma en `providerFromConfig` (todos los mapas y las descargas offline).

## Consecuencias

- Una región descargada queda en el idioma de ese momento; las teselas se comparten si luego se cambia de idioma.
- Configurar `MAP_STYLE_URL_*` con `{lang}` al publicar el mapa (bloqueado por el bucket del propietario).
- Prueba: `packages/contracts/test/map-style.test.ts`; el generador se probó localmente (10 estilos, 71 capas).
