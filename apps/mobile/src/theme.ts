/**
 * Tema visual (según la imagen de referencia del propietario, docs/design/referencia-inicio.jpg):
 * oscuro, acento rojo y colores por categoría. Un único tema para Android e iOS.
 */
export const colors = {
  bg: "#0B0F14",
  surface: "#151B23",
  surfaceAlt: "#1C232D",
  border: "#27303B",
  text: "#F2F4F7",
  textMuted: "#9AA4B2",
  accent: "#E5262E",
  accentSoft: "#3A1416",
  like: "#F0434B",
  white: "#FFFFFF",
} as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
