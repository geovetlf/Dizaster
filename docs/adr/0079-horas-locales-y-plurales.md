# ADR 0079 — Horas en la zona del evento y plurales correctos en 4 idiomas

- Estado: aceptada (2026-09-29)
- Blueprint: §5.15 ("fechas guardadas en UTC y mostradas en la zona del evento y del usuario"; catálogos ICU)
- IA: **NO AI REQUIRED**. Costo: 0 (todo en el teléfono).

## Contexto

La ficha del evento mostraba las horas con la zona del teléfono y sin decirlo: alguien en Madrid que mira un
sismo en Lima veía la hora de Madrid como si fuera la del lugar. Los conteos usaban siempre el plural
("1 reportes").

## Decisión

- `eventTime` (`apps/mobile/src/lib/ui/format.ts`): hora en la zona del evento (`place.timezone`, que calcula el
  servidor desde el punto público, ADR 0016) y, si la persona está en otra zona, también la suya:
  "14:05 hora local · 21:05 tu hora". Si el motor de JS no conoce la zona, cae a la hora del teléfono.
  Se usa en la ficha del evento (primera vez visto) y en su línea de tiempo.
- `pluralCategory` (`apps/mobile/src/lib/ui/plural.ts`): reglas CLDR de enteros para es/en (singular solo con 1) y
  pt-BR/fr (singular con 0 y 1), escritas a mano para no depender de `Intl.PluralRules`, que no está en todos los
  motores de JS móviles. `tCount(n, one, other)` en `i18n.ts`; claves `report_one`/`source_one` en los 4 idiomas.

## Consecuencias

- Las horas son inequívocas para quien sigue un evento desde otra zona.
- Otros conteos que aparezcan se escriben con `tCount` y un par de claves `_one`/plural.
- Pruebas: `apps/mobile/test/plural-time.test.ts`.
