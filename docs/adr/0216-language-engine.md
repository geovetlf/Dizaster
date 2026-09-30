# ADR 0216 — DIZASTER Language Engine sobre el i18n existente

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

La app ya tenía i18n en cuatro idiomas (ADR 0069, 0079, 0091, 0102), pero cada pieza sabía por su cuenta qué idiomas
existen: nombres de idiomas, plurales escritos a mano, locales de formato (`lang === "pt" ? "pt-BR" : lang`), respaldos
`?? es` sueltos, variables reemplazadas con `.replace("{n}", …)` y un CHECK en la base con la lista de idiomas.
Agregar un idioma tocaba una docena de archivos y una migración. El dueño pidió extender el sistema existente, sin
crear uno paralelo ni reutilizar código de otros proyectos, y sin IA para la interfaz.

## Decisión

- Un registro único en `@dizaster/contracts` (`language-engine.ts`): nombre propio, dirección, locale por defecto,
  cadena de respaldo y regla plural CLDR de cada idioma.
- `resolveLocale`: elección manual → teléfono → país → respaldo global; devuelve también el locale de formatos con la
  región de la persona.
- `formatMessage` (ICU simplificado: variables y plurales con `=N`, categorías CLDR y `#`) y `tf` en la app. Los
  `.replace("{…}")` pasan a `tf`; "reportes sin enviar" usa plural real.
- Formatos regionales comunes (`formatNumber`, `formatCurrency`, `formatDateTime`, `formatTimeAgo`) y `appLocale` en
  la app: fechas y horas siguen el locale resuelto (`es-PE` usa reloj de 12 h).
- `localizedText` para datos con nombres por idioma (categorías, números de emergencia, títulos).
- La base deja de enumerar idiomas: migración 0092 cambia el CHECK de `alert.preferences.lang` por uno de formato;
  un valor desconocido se lee como el respaldo global.
- `country-config.json` gana `currency` (Perú: PEN).
- Pruebas de completitud: textos vacíos, variables distintas al español y plurales sin resolver hacen fallar `pnpm check`.

## Consecuencias

- Agregar un idioma: registro + catálogo + tablas que TypeScript marque; sin migración ni cambios de negocio
  (`docs/LANGUAGE_ENGINE.md`).
- Las horas en teléfonos peruanos se muestran en formato de 12 h, como es costumbre local.
- Los nombres de niveles administrativos del país siguen en español en los datos; localizarlos es un cambio de datos.
