# DIZASTER Language Engine

Motor de idiomas de DIZASTER (ADR 0216). No es un sistema nuevo: es el i18n que ya existía (ADR 0069, 0079, 0091,
0102) con un registro único de idiomas en `@dizaster/contracts` que usan la app, el servidor y los datos.

Principios:

- Los textos de la interfaz son **locales y versionados** (archivos en el repo, revisados como código). La interfaz
  nunca se traduce con IA. Solo el contenido que escriben las personas podría traducirse en el futuro, y eso pasa por
  el AI Core con la capacidad `TRANSLATE_TEXT`, apagada por defecto.
- Todo es determinístico y funciona sin red: plurales, formatos y resolución de idioma no dependen de ningún servicio.
- Lo específico de un país es dato (`data/countries/country-config.json`), nunca código.

## Estructura

| Pieza | Dónde | Qué hace |
|---|---|---|
| Idiomas soportados | `packages/contracts/src/common.ts` (`SUPPORTED_LANGS`) | Lista cerrada que valida la API (zod). |
| Registro de idiomas | `packages/contracts/src/language-engine.ts` (`LANGUAGES`) | Nombre propio, dirección (LTR/RTL), locale por defecto, cadena de respaldo, regla plural CLDR. |
| Resolución | `resolveLocale` | Elección manual → idioma del teléfono → idioma del país → respaldo global (`es`, luego `en`). Devuelve idioma, locale de formatos (p. ej. `es-PE`), dirección y origen. |
| Mensajes | `formatMessage` / `tf` en la app | Variables `{name}` y plurales `{n, plural, =0 {…} one {# …} other {# …}}`. |
| Formatos regionales | `formatNumber`, `formatCurrency`, `formatDateTime`, `formatTimeAgo` | Intl con respaldo; mismo resultado en app y servidor. |
| Datos localizados | `localizedText(texts, lang)` | Nombres de categorías, números de emergencia, títulos de eventos: busca en la cadena de respaldo del idioma. |
| Textos de la app | `apps/mobile/src/lib/i18n.ts` (es, en) y `apps/mobile/src/lib/locales/*.ts` | Catálogos `Record<MessageKey, string>`: TypeScript no compila si falta una clave. |
| Textos del servidor | `services/core/src/modules/alert/rules.ts` | Avisos push, avisos de moderación, alertas de operación: tablas `Record<Lang, …>`. |
| Textos regionales | `data/locales/ui-regional.json` y `apps/mobile/src/lib/locales/regional.ts` | Ajuste de un texto para un país dentro de un idioma ("es-PE"), validado contra el catálogo (ADR 0281). Vacío hasta tener uso local real. |
| Configuración por país | `data/countries/country-config.json` | `defaultLocale`, `languages`, `timezones`, `units`, `currency`, nombres de niveles administrativos. |
| Dirección | `apps/mobile/src/lib/ui/direction.ts` | Sigue al idioma de la app, no al del teléfono; los idiomas del registro mandan. |

La base de datos no enumera idiomas: `alert.preferences.lang` solo exige un código bien formado (migración 0092). Un
código que la versión en curso no conoce se lee como el respaldo global.

## Resolución del idioma y del locale

1. Si la persona eligió un idioma en su perfil, ese.
2. Si no, el primer idioma del teléfono que la app soporte.
3. Si no, el idioma por defecto del país.
4. Si no, `es` (idioma del piloto).

La región de los formatos sale del teléfono si habla el mismo idioma (`es-PE`), si no del país, si no la del idioma
por defecto. Así un teléfono peruano ve horas y números como en Perú (`02:05 p. m.`, `1,200`).

## Cómo agregar un idioma

1. Agregar el código a `SUPPORTED_LANGS` (`packages/contracts/src/common.ts`).
2. Agregar su entrada a `LANGUAGES` y a `RELATIVE_FALLBACK` en `packages/contracts/src/language-engine.ts`
   (nombre propio, dirección, locale, respaldo, regla plural de CLDR `plurals.xml`).
3. Crear `apps/mobile/src/lib/locales/<código>.ts` copiando el español y traducir; registrarlo en `catalogs` de
   `apps/mobile/src/lib/i18n.ts`.
4. Completar las tablas `Record<Lang, …>` que TypeScript marque (servidor: `alert/rules.ts`; app: categorías,
   negocios, distancias).
5. Agregar nombres en los datos cuando corresponda (categorías, números de emergencia).
6. `pnpm check`. Las pruebas de completitud fallan si un texto queda vacío, si sus variables no coinciden con las del
   español o si un plural no se resuelve.

Ninguna regla de negocio cambia. No hace falta migración.

## Pruebas

- `packages/contracts/test/language-engine.test.ts`: registro, plurales CLDR, respaldo, resolución, mensajes, formatos.
- `apps/mobile/test/language-engine.test.ts`: completitud de los catálogos (vacíos, variables, plurales).
- `apps/mobile/test/language-regional.test.ts`: textos regionales y motivos de moderación automática (ADR 0281).

## Nunca en español fuera del español (ADR 0281)

- Error con código desconocido: se traduce por estado HTTP; el mensaje del servidor solo se muestra en español.
- Motivo de una regla automática de moderación: texto del catálogo; el motivo de un moderador es texto libre y va tal cual.
- El texto libre de las personas (posts, comentarios, motivos) nunca se traduce solo: eso sería `TRANSLATE_TEXT`, apagado.
- `services/core/test/language-engine.test.ts`: idioma de avisos, respaldo de valores desconocidos, datos por país.
