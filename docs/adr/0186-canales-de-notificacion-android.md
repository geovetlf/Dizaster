# ADR 0186 — Canales de notificación de Android como los niveles de iOS

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.10: en iOS una confirmación oficial grave llega como `time-sensitive` y el resto como `active`. En Android todo
iba por un único canal `alerts` con nombre fijo en español: quien silenciaba el canal por ruido de la comunidad
perdía también las alertas oficiales graves.

## Decisión

- Contratos: `ANDROID_CHANNELS = { critical: "official_critical", general: "alerts" }` y `androidChannelFor(critical)`,
  compartidos por servidor y app.
- Servidor (FCM): `channel_id` sale de `critical` (la misma marca que da prioridad HIGH en FCM y `time-sensitive` en
  APNs: oficial y severidad alta, ADR de reglas de alerta).
- App: crea los dos canales al arrancar con nombre y descripción traducidos (es/en/pt/fr). El oficial grave tiene
  importancia máxima, visible en pantalla de bloqueo y vibración propia. No se usa "saltar No molestar" (exige un
  permiso especial y revisión de tienda).
- El canal general conserva el id `alerts`: los teléfonos que ya lo tenían no pierden la preferencia elegida.

## Consecuencias

- Paridad Android/iOS en cómo interrumpe cada tipo de alerta. Prueba en `test/push-providers.test.ts`.
