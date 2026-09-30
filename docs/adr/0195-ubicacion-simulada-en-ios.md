# ADR 0195 — Ubicación simulada también en iOS

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§8.2: "ubicación simulada" es una señal de presencia. En Android expo-location trae `mocked`; en iOS no, así que la
app enviaba `mockLocation: null` y la señal solo existía en Android (falta de paridad).

## Decisión

- iOS 15+ expone `CLLocation.sourceInformation.isSimulatedBySoftware`. Parche local mínimo de expo-location
  (`patches/expo-location@57.0.20.patch`, `pnpm patchedDependencies`): la misma lectura que usa la app lleva
  `mocked` en iOS, igual que en Android. Sin módulo nativo propio (sería otra lectura, no la misma).
- `toPresenceSignals` no cambia: ya usaba `mocked` si viene y `null` si no.
- `provider` sigue siendo `FUSED` en ambos: FusedLocationProvider (Android) y CoreLocation (iOS) combinan GNSS,
  Wi-Fi y celdas y no dicen de cuál salió cada lectura.
- Prueba `apps/mobile/test/location-patch.test.ts`: falla si una actualización de expo-location deja el parche
  sin aplicar (al subir de versión hay que regenerarlo con `pnpm patch`).

## Consecuencias

- Paridad de la señal. El código Swift solo se compila en el primer build de iOS (bloqueado por cuenta de Apple /
  EXPO_TOKEN); el cambio es de 5 líneas con `#available(iOS 15.0, *)`.
- El servidor sigue tratando la señal como una más: nunca decide sola.
