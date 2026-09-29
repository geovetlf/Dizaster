import type { ExpoConfig } from "expo/config";

/**
 * Configuración de la app. Dizaster V1 es SOLO APP (iOS + Android): la plataforma web no se compila.
 *
 * Enlaces: esquema propio `dizaster://` siempre; Universal Links (iOS) y App Links (Android) solo cuando
 * exista el dominio aprobado (D-21). Se activa con DIZASTER_LINK_DOMAIN sin tocar código.
 */
const linkDomain = process.env["DIZASTER_LINK_DOMAIN"];
// Sin valor, la app elige el backend local según la plataforma (ver src/lib/config.ts).
const apiUrl = process.env["DIZASTER_API_URL"] ?? null;
// Proyecto EAS (se obtiene con `eas init` usando la cuenta Expo del propietario). Sin él, la app compila igual.
const easProjectId = process.env["DIZASTER_EAS_PROJECT_ID"];
// APNs: "development" para builds de desarrollo, "production" para TestFlight/App Store.
const apnsMode = process.env["DIZASTER_APNS_MODE"] === "production" ? "production" : "development";

const LOCATION_TEXT =
  "Dizaster usa tu ubicación solo cuando reportas un incidente, para comprobar que estás en el lugar. Tu ubicación exacta no se publica.";
const CAMERA_TEXT = "Dizaster usa la cámara para tomar fotos o videos del incidente que reportas.";
const PHOTOS_TEXT = "Dizaster accede a las fotos y videos que elijas para adjuntarlos a un reporte.";
const MIC_TEXT = "Dizaster usa el micrófono para grabar el audio de los videos que adjuntas a un reporte.";

const config: ExpoConfig = {
  name: "Dizaster",
  slug: "dizaster",
  scheme: "dizaster",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  platforms: ["ios", "android"],
  ios: {
    supportsTablet: false,
    // Identificador provisional hasta aprobar marca y dominio (D-21).
    bundleIdentifier: "app.dizaster.mobile",
    ...(linkDomain ? { associatedDomains: [`applinks:${linkDomain}`] } : {}),
    // Solo una confirmación oficial grave usa "time-sensitive" (atraviesa Concentración). Capacidad gratuita;
    // EAS la activa en el App ID al firmar. Sin "critical alerts": requieren permiso especial de Apple.
    entitlements: { "com.apple.developer.usernotifications.time-sensitive": true },
    infoPlist: {
      NSLocationWhenInUseUsageDescription: LOCATION_TEXT,
      NSCameraUsageDescription: CAMERA_TEXT,
      NSPhotoLibraryUsageDescription: PHOTOS_TEXT,
      NSMicrophoneUsageDescription: MIC_TEXT,
      // Solo cifrado estándar del sistema (HTTPS): evita la pregunta de exportación en cada envío a App Store.
      ITSAppUsesNonExemptEncryption: false,
    },
    // Manifiesto de privacidad exigido por Apple. Sin rastreo publicitario.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp", NSPrivacyAccessedAPITypeReasons: ["C617.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime", NSPrivacyAccessedAPITypeReasons: ["35F9.1"] },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace", NSPrivacyAccessedAPITypeReasons: ["E174.1"] },
      ],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePreciseLocation",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePhotosorVideos",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
        {
          NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeDeviceID",
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
        },
      ],
    },
  },
  android: {
    package: "app.dizaster.mobile",
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    // Sin ubicación en segundo plano en V1 (decisión D-16).
    // Misma lista de capacidades que iOS (paridad). POST_NOTIFICATIONS lo exige Android 13+.
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "CAMERA",
      "RECORD_AUDIO",
      "POST_NOTIFICATIONS",
    ],
    // Mínimo privilegio, igual que en iOS: sin ubicación en segundo plano, sin superposición de ventanas y sin
    // acceso amplio al almacenamiento (el selector de fotos del sistema no lo necesita).
    blockedPermissions: [
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],
    // FCM: el archivo lo descarga el propietario desde Firebase (ver docs/MOBILE_PLATFORMS.md); no se versiona.
    ...(process.env["DIZASTER_GOOGLE_SERVICES_FILE"] ? { googleServicesFile: process.env["DIZASTER_GOOGLE_SERVICES_FILE"] } : {}),
    ...(linkDomain
      ? {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              data: [{ scheme: "https", host: linkDomain, pathPrefix: "/e/" }],
              category: ["BROWSABLE", "DEFAULT"],
            },
          ],
        }
      : {}),
  },
  plugins: [
    "expo-router",
    "expo-sqlite",
    [
      "expo-location",
      {
        locationWhenInUsePermission: LOCATION_TEXT,
        // Sin ubicación "siempre" ni sensores de movimiento en V1 (D-16): se retiran los textos por defecto.
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    ["expo-image-picker", { photosPermission: PHOTOS_TEXT, cameraPermission: CAMERA_TEXT, microphonePermission: MIC_TEXT }],
    ["expo-notifications", { color: "#C62828", defaultChannel: "alerts", mode: apnsMode }],
    // Tokens de sesión en Keychain (iOS) y Keystore (Android).
    ["expo-secure-store", { faceIDPermission: false }],
    "expo-system-ui",
    "@maplibre/maplibre-react-native",
  ],
  experiments: { typedRoutes: false },
  extra: { apiUrl, apnsMode, linkDomain: linkDomain ?? null, ...(easProjectId ? { eas: { projectId: easProjectId } } : {}) },
  ...(process.env["DIZASTER_EXPO_OWNER"] ? { owner: process.env["DIZASTER_EXPO_OWNER"] } : {}),
};

export default config;
