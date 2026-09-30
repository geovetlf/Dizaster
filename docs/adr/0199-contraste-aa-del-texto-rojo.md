# ADR 0199 — Contraste AA del texto rojo y prueba de contraste del tema

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§11.4 (accesibilidad). El rojo de acento `#E5262E` se usaba como color de texto en 41 sitios (errores, enlaces de
acción, números de emergencia). Sobre el fondo oscuro da 4,25:1 y sobre las tarjetas 3,83:1: por debajo de WCAG AA
(4,5:1) justo en los textos de error, que son los que más importa leer.

## Decisión

- Nuevo token `colors.accentText = #FF5A5F` (5,2–6,3:1 en todos los fondos) para todo texto rojo. El acento
  original sigue para iconos, bordes, interruptores y fondos de botón (elementos no textuales: 3:1), y el blanco
  sobre botón rojo cumple 4,5:1. La identidad visual del propietario no cambia.
- `lib/a11y/contrast.ts` (fórmula WCAG) y `test/contrast.test.ts`: texto normal, atenuado, enlace y rojo cumplen AA
  sobre fondo, tarjeta, tarjeta alterna y fondo rojo suave; un cambio de tema que lo rompa no pasa las pruebas.

## Consecuencias

- Mismo tema en Android e iOS, errores legibles para personas con baja visión y a pleno sol.
