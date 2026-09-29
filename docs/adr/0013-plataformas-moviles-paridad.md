# ADR 0013 — Android e iOS con paridad desde el inicio

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §4.3 (D-01), ADR 0009
- Origen: instrucción del propietario "PLATAFORMAS MÓVILES" (2026-09-29).

## Contexto
V1 se publica en Android **e** iOS. El propietario solo tiene hoy un dispositivo Android, pero eso no puede
producir una arquitectura Android-first. Se pidió evaluar técnicamente el stack antes de confirmarlo.

## Opciones evaluadas

Escala: ●●● fuerte · ●● adecuado · ● débil.

| Criterio | React Native + Expo | Flutter | Kotlin/Compose Multiplatform | Nativo (Swift + Kotlin) | Capacitor / Ionic |
|---|---|---|---|---|---|
| Rendimiento | ●● nueva arquitectura (Fabric/JSI), UI nativa | ●●● motor propio | ●●● (Android), ●● (UI Compose en iOS) | ●●● | ● WebView |
| Mapas (MapLibre, proveedor propio) | ●●● `@maplibre/maplibre-react-native` oficial | ●● `maplibre_gl` comunitario | ● sin SDK multiplataforma maduro | ●●● SDKs nativos oficiales | ● MapLibre GL JS en WebView |
| GPS / permisos de ubicación | ●●● expo-location | ●●● geolocator | ●● expect/actual propio | ●●● | ●● |
| Cámara, fotos, video | ●●● expo-camera, image-picker, video | ●●● | ●● | ●●● | ●● |
| Push (APNs + FCM directos) | ●●● expo-notifications da el token nativo | ●●● | ●● | ●●● | ●● |
| Deep / Universal / App Links | ●●● Expo Router + config | ●●● | ●● | ●●● | ●● |
| Almacenamiento local seguro | ●●● SQLite + Keychain/Keystore | ●●● | ●●● | ●●● | ●● |
| Seguridad (atestación futura) | ●● App Attest / Play Integrity vía módulo nativo | ●● igual | ●●● | ●●● | ● |
| Un solo código para ambas | ●●● | ●●● | ●● (UI iOS aún joven) | ● dos apps | ●●● |
| iOS sin Mac propio | ●●● EAS Build en la nube | ●● CI macOS | ●● CI macOS | ● requiere Mac | ●● CI macOS |
| Contratos compartidos con backend | ●●● TypeScript en todo el sistema | ● Dart | ● Kotlin | ● | ●●● |
| Mantenimiento / equipo | ●●● un lenguaje | ●● | ●● | ● dos equipos | ●● |
| Costo | ●●● | ●● | ●● | ● el doble | ●●● |

## Decisión
**Se confirma React Native + Expo (SDK 57, TypeScript)** con estas reglas de paridad:

1. **Un solo código** (`apps/mobile`) para iOS y Android. Nada de ramas o carpetas por plataforma en la lógica;
   las diferencias de sistema se aíslan en módulos pequeños (`src/lib/config.ts`, `src/lib/device/`).
2. **Continuous Native Generation**: `ios/` y `android/` se generan desde `app.config.ts`; nunca se editan a mano ni se versionan.
3. **Mismas capacidades declaradas en ambas**: ubicación mientras se usa, cámara, micrófono, fotos y push.
   Lo que V1 no usa (ubicación en segundo plano, Face ID, sensores de movimiento, superposición de ventanas,
   acceso amplio al almacenamiento) se retira en las dos.
4. **Push directo sin intermediario de pago**: token nativo APNs (iOS) o FCM (Android) → `PUT /v1/devices/:id/push-token`.
   El backend exige que el proveedor corresponda a la plataforma (restricción en BD y en dominio).
5. **Secretos del dispositivo en Keychain (iOS) / Keystore (Android)** con `expo-secure-store`, solo en ese dispositivo.
6. **Verificación automática de paridad**:
   - `test/platform-parity.test.ts`: la configuración declara cada capacidad en ambas plataformas.
   - `pnpm native:check` (en CI): genera los proyectos nativos reales de iOS y Android y comprueba permisos,
     textos, entitlement de push, manifiesto de privacidad y esquema de enlaces.
   - `bundle:check` (en CI): compila el JS para iOS y Android.
7. **iOS sin Mac**: compilación y firma en la nube con EAS Build (`eas.json`, workflow manual `mobile-build`).
   Android nunca espera a iOS; iOS nunca se deja para después.

## Por qué no las alternativas
- **Flutter**: igual de válido en rendimiento; pierde en MapLibre (paquete comunitario), en contratos compartidos y
  en compilar iOS sin Mac.
- **Kotlin/Compose Multiplatform**: la UI en iOS aún es joven y no hay SDK de mapas multiplataforma maduro;
  empujaría a construir primero Android y adaptar iOS después, justo lo que se prohibió.
- **Nativo x2**: mejor techo técnico, pero duplica costo y equipo y crea riesgo de divergencia funcional.
- **Capacitor**: WebView para un mapa intensivo y video: rendimiento insuficiente.

## Consecuencias
- Los pasos que exigen cuenta Apple o dispositivo Apple están en `docs/MOBILE_PLATFORMS.md`.
- Las funciones con límites distintos por sistema (p. ej. atestación: App Attest vs Play Integrity) se exponen al
  backend con el mismo contrato (`AttestationVerdict`).
- Si una capacidad solo existe en una plataforma, se documenta en la matriz de paridad antes de implementarla.
