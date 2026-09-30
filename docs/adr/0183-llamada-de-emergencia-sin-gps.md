# ADR 0183 — Botón de llamada de emergencia sin esperar al GPS

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.1: en una emergencia el botón de llamada debe aparecer al instante. Antes el número local se elegía con el país
del primer fix de GPS: bajo techo o con el permiso denegado el botón tardaba o no salía, y la pantalla se quedaba en
"Buscando ubicación". Con la cámara pasaba algo parecido: sin permiso, adjuntar no hacía nada.

## Decisión

- `lib/geo/device-country.ts` → `quickCountry()`: país sin esperar al GPS (última posición conocida → SIM → perfil
  → región del teléfono). Al elegir una categoría de severidad ≥ 4 el botón de llamada sale ya con ese país; cuando
  llega el fix se refina como antes.
- El fix tiene un tiempo límite (`FIX_TIMEOUT_MS = 20 s`, `lib/async/timeout.ts`). Si no llega, se explica
  ("sal a un lugar abierto") con un botón Reintentar, y el botón de llamada sigue visible.
- Permiso de ubicación denegado → botón "Abrir ajustes" (`Linking.openSettings()`), igual en Android e iOS.
- Cámara denegada → `CameraDeniedError`; el adjunto muestra el motivo y "Abrir ajustes".

## Consecuencias

- La llamada nunca depende del GPS. El reporte sigue necesitando el fix (la ubicación es la evidencia).
- Sin coste ni proveedor: todo en el teléfono. Prueba: `test/timeout.test.ts`.
