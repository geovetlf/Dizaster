# ADR 0024 — Idiomas iniciales: español, inglés, portugués y francés

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint D-19

## Decisión
- `SUPPORTED_LANGS = ["es", "en", "pt", "fr"]` y `langFromLocale` viven en contracts: la app y el servidor
  usan la misma lista. El idioma se elige por el locale del teléfono ("pt-BR" → pt); si no hay coincidencia,
  español.
- **App**: el español es el catálogo de referencia; inglés, portugués y francés son `Record<MessageKey, string>`
  (`apps/mobile/src/lib/locales/`), así que TypeScript no compila si falta una clave. También se traducen los
  accesos rápidos de categorías, estados de verificación, tiempos relativos, distancias e importes.
- **Diálogos de permisos del sistema** (iOS): `InfoPlist.strings` por idioma vía `locales` de Expo, con
  `CFBundleAllowMixedLocalizations`. El chequeo nativo exige los cuatro idiomas. En Android los permisos no
  llevan texto propio: la explicación está en la app.
- **Datos**: los nombres de las 43 categorías y las etiquetas de números de emergencia tienen los cuatro
  idiomas; un test lo exige.
- **Avisos push**: el texto se genera en el idioma de cada persona (preferencia `lang`, que la app sincroniza
  con el teléfono). Las frases de cada idioma están en una tabla tipada: un idioma nuevo es una entrada más.

## Consecuencias
- Sin coste. Las traducciones de portugués y francés las hizo el agente: conviene una revisión por hablantes
  nativos antes de publicar en países de esos idiomas (no bloquea el piloto en Perú).
- Pendiente: formato ICU (plurales) si algún texto lo necesita; hoy ninguno depende de plurales complejos.
