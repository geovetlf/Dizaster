# ADR 0069: Idioma de la app elegible en el perfil

- Estado: aceptada (Blueprint §5.2; motor I18N determinista)
- IA: **NO AI REQUIRED**. API externa: ninguna. Costo: 0.

## Decisión

- Perfil → "Idioma": "Del teléfono" (por defecto), Español, English, Português, Français. Cada idioma se nombra en sí
  mismo.
- La elección se guarda en un archivo local (`app-language.txt`) y se aplica **antes** de cargar cualquier pantalla:
  la entrada de la app es `index.ts`, que importa `language-boot` y después `expo-router/entry`.
- Al cambiarla, se vuelve a montar la navegación (títulos y pantallas en el idioma nuevo) y se actualiza la preferencia
  de idioma de los avisos push en el servidor.
- Un valor guardado desconocido (idioma retirado) vuelve a "Del teléfono". Un idioma del sistema no soportado cae en
  español.
- Añadir un idioma sigue siendo un catálogo más (`locales/<xx>.ts`, tipado contra el español) y una entrada en
  `SUPPORTED_LANGS`.

## Consecuencias

- Algunos textos calculados al cargar un módulo (p. ej. nombres de categorías en el feed) terminan de cambiar al
  reabrir la app.
