# Plataformas móviles: Android e iOS

Dizaster V1 es una sola app para **Android e iOS**, construida con el mismo código (React Native + Expo).
La evaluación y la decisión están en [ADR 0013](adr/0013-plataformas-moviles-paridad.md).

## Matriz de paridad

| Función | Android | iOS | Notas |
|---|---|---|---|
| Mapa MapLibre con proveedor intercambiable | ✅ | ✅ | Mismo componente y estilo |
| Ubicación solo mientras se usa (GPS del sistema) | ✅ | ✅ | Sin segundo plano en ninguna (D-16) |
| Reporte con presencia, pin limitado y "¿es este?" | ✅ | ✅ | |
| Cola offline (SQLite) | ✅ | ✅ | |
| Números de emergencia sin conexión | ✅ | ✅ | Llamada con `tel:` en ambas |
| Deep links `dizaster://` | ✅ | ✅ | |
| App Links / Universal Links | ✅ preparado | ✅ preparado | Se activan con el dominio (D-21) |
| Identidad del dispositivo en almacén seguro | ✅ Keystore | ✅ Keychain | Solo en el dispositivo, sin copia de seguridad |
| Token push nativo | ✅ FCM | ✅ APNs | Permiso pedido en contexto, no al abrir |
| Alertas: historial, ajustes, deep link al EVENT, permiso bloqueado → Ajustes | ✅ canal "alerts" | ✅ `time-sensitive` solo oficial grave | ADR 0018 |
| Cámara, fotos, video | ⏳ etapa 3 | ⏳ etapa 3 | Permisos ya declarados en ambas |
| Atestación del dispositivo | ⏳ | ⏳ | Play Integrity / App Attest, mismo contrato |

Cualquier diferencia futura entre plataformas se anota aquí antes de implementarla.

## Cómo se garantiza la paridad

- `pnpm --filter @dizaster/mobile test`: la configuración declara cada capacidad en las dos plataformas.
- `pnpm --filter @dizaster/mobile native:check`: genera los proyectos nativos reales de iOS y Android y comprueba
  permisos, textos, push, manifiesto de privacidad y enlaces. Corre en CI en cada cambio.
- `pnpm --filter @dizaster/mobile bundle:check`: compila el JavaScript para iOS y Android. También en CI.

Todo esto funciona en Linux, sin Mac.

## Compilar sin Mac: EAS Build

`apps/mobile/eas.json` define los perfiles:

| Perfil | Android | iOS | Uso |
|---|---|---|---|
| `development` | APK instalable | build interna (dispositivos registrados) | Pruebas del equipo |
| `ios-simulator` | — | build para simulador | Requiere Mac para ejecutarla |
| `preview` | APK instalable | build interna | Pruebas con usuarios del piloto |
| `production` | AAB para Google Play | build para App Store / TestFlight | Publicación |

Se lanza a mano desde GitHub Actions (workflow `mobile-build`) o con `npx eas-cli build -p all --profile preview`.
No se ejecuta en cada push para no gastar el cupo de builds (cost-first).

La app usa módulos nativos (MapLibre, SQLite, almacenamiento seguro), así que **no funciona en Expo Go**:
hay que instalar una build propia (APK en Android).

## Pasos que requieren al propietario

El agente no puede crear cuentas, aceptar contratos ni pagar. Todo lo demás ya está preparado.

### Comunes (Expo)
1. Crear una cuenta gratuita en expo.dev.
2. Crear un token de acceso (expo.dev → Account settings → Access tokens).
3. En el repositorio de GitHub: secreto `EXPO_TOKEN` y variables `DIZASTER_EXPO_OWNER` (usuario de Expo).
4. El agente ejecuta `eas init` con ese token y guarda `DIZASTER_EAS_PROJECT_ID`.

### Android (se puede hacer ya)
1. **Probar en tu Android**: con los pasos de Expo hechos, el agente lanza una build `preview` y te da el enlace del APK.
2. **Push (FCM)**: crear un proyecto gratuito en Firebase con el paquete `app.dizaster.mobile`, descargar
   `google-services.json` y dárselo al agente (se guarda como archivo secreto de EAS, nunca en el repositorio).
   Para enviar push desde el backend hace falta además una cuenta de servicio de Firebase (Firebase → Configuración
   del proyecto → Cuentas de servicio → Generar clave privada). Ese JSON va al servidor como
   `FCM_SERVICE_ACCOUNT_JSON` (texto o base64), con `PUSH_DRIVER=live`.
3. **Publicar**: cuenta de Google Play Console (pago único de US$25).

### iOS (requiere cuenta Apple; no requiere Mac)
1. **Apple Developer Program** (US$99 al año). Decide si es cuenta individual o de organización: la de
   organización necesita número D-U-N-S y muestra el nombre de la entidad en el App Store. Es una decisión legal.
2. **Clave de App Store Connect API** (App Store Connect → Usuarios y acceso → Integraciones → claves, rol
   App Manager). Con ella EAS crea certificados, perfiles de aprovisionamiento y el identificador
   `app.dizaster.mobile` con las capacidades Push Notifications y Associated Domains, sin sesión interactiva.
3. **Clave APNs (.p8)** (Apple Developer → Certificates, IDs & Profiles → Keys) para que el backend envíe push.
   Se guarda como secreto del servidor: `APNS_PRIVATE_KEY` (contenido del .p8 o base64), `APNS_KEY_ID`,
   `APNS_TEAM_ID`. El identificador de la app necesita también la capacidad Time Sensitive Notifications
   (gratuita; EAS la activa al firmar).
4. **Probar en un iPhone real**: una build interna solo se instala en iPhones registrados (su UDID), y TestFlight
   también necesita un iPhone. Sin iPhone propio hay tres caminos: registrar el iPhone de un tester de confianza,
   usar TestFlight con testers del piloto o contratar un servicio de dispositivos en la nube (con costo).
   **Antes de publicar en el App Store debe probarse al menos una vez en un iPhone físico.**
5. **Publicar**: registro de la app en App Store Connect, etiquetas de privacidad (coinciden con el manifiesto
   de privacidad ya declarado), clasificación por edad y capturas de pantalla.

Mientras tanto el desarrollo sigue: cada cambio se valida para iOS en CI (JS y proyecto nativo generado).
