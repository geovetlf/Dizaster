# ADR 0202 — Todo texto localizado de `data/` en los 4 idiomas

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.15 y §7.3 (`CategoryRegionConfig`): los nombres regionales de Perú ("Huaico", "Heladas y friaje") solo tenían
español e inglés. Como `effectiveCategory` combina nombres, quien usa la app en portugués o francés en Perú veía el
nombre genérico mientras en español o inglés veía el local. Los catálogos de la app ya obligan a los 4 idiomas por
tipos; los datos no.

## Decisión

- Nombres en portugués y francés para los dos ajustes regionales; catálogo `categories-2026.09.3` (las apps lo
  descargan solas).
- `services/core/test/data-languages.test.ts` recorre todos los JSON de `data/` y exige es, en, pt y fr en cada
  objeto de textos localizados (claves de idioma con valores de texto; se admiten además qu/ay).

## Consecuencias

- Un dato nuevo (categoría, ajuste regional, fuente, número de emergencia) no puede entrar sin los 4 idiomas.
