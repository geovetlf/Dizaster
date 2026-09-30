# ADR 0198 — Lector de pantalla: nombres de controles y anuncios de estado

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§11.4: la app debe poder usarse con TalkBack y VoiceOver, sobre todo en una emergencia. Faltaban nombres accesibles
en controles clave (Me gusta y Comentarios se leían como un número, la cuadrícula de fotos sin nombre), 31 campos de
texto dependían solo del placeholder (el del reporte era "…") y ningún cambio de estado se anunciaba.

## Decisión

- Todos los `TextInput` con `accessibilityLabel` traducido; el campo del reporte dice "Describe lo que ves
  (opcional)". Me gusta, Comentarios y la media del post con nombre y cuenta.
- `lib/a11y/announce.ts`: `announce`/`useAnnounce` (`AccessibilityInfo.announceForAccessibility`, igual en Android e
  iOS). En la pantalla de reporte se anuncia cada estado (buscando ubicación, sin señal, sin permiso, enviando,
  guardado sin conexión, resultado, error) y los mensajes de adjuntar fotos.
- `useReduceMotion`: con "reducir movimiento" del sistema, los modales se abren sin animación.
- Pruebas `test/a11y-labels.test.ts`: todo `TextInput` con nombre accesible y ninguna etiqueta accesible escrita a
  mano fuera de las traducciones (había una en inglés en el panel de costos).

## Consecuencias

- Las pantallas nuevas no pueden añadir un campo sin nombre accesible.
