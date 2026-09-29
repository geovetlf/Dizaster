# ADR 0152 — Catálogo de categorías remoto y ajustes por país en la app

- Estado: aceptada (2026-09-29) · AI_REQUIRED: no · COST: una petición condicional por apertura (304 sin cuerpo)

## Contexto

§5.15 y §6.3: las categorías son datos y cada país puede ajustarlas (nombres locales como "Huaico", radio de
presencia, desactivar una categoría). El servidor ya aplicaba los `regionOverrides`; la app usaba solo el JSON
empaquetado, sin ajustes por país y sin poder recibir un catálogo nuevo sin publicar otra versión.

## Decisión

- Contracts: `effectiveCategory(catalog, code, country)` y `categoriesFor(catalog, country)`; el servidor
  (`ReferenceData.category`) usa la misma función, así app y servidor no pueden divergir.
- App `lib/category-store.ts`: catálogo empaquetado (sin red) o el descargado si es válido y de versión más nueva,
  guardado con su etag; `refreshCategoryCatalog()` al abrir la app pregunta con `If-None-Match` (ADR 0084).
  Los selectores (reportar, buscar, chips de inicio y mapa, suscripciones) se redibujan si llega uno nuevo.
- Mostrar usa el país preferido del perfil y nunca pierde el nombre (si allí está desactivada, cae a la base).
  Elegir solo ofrece lo disponible en ese país.
- Reportar aplica los ajustes del país donde está la persona (calculado en el teléfono): si allí la categoría está
  desactivada o no es ciudadana, se avisa y se vuelve a elegir; el radio de presencia es el del país.
