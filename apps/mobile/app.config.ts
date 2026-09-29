import type { ExpoConfig } from "expo/config";

/**
 * Configuración de la app. Dizaster V1 es SOLO APP (iOS + Android): la plataforma web no se compila.
 *
 * Enlaces: esquema propio `dizaster://` siempre; Universal Links (iOS) y App Links (Android) solo cuando
 * exista el dominio aprobado (D-21). Se activa con DIZASTER_LINK_DOMAIN sin tocar código.
 */
const linkDomain = process.env["DIZASTER_LINK_DOMAIN"];
const apiUrl = process.env["DIZASTER_API_URL"] ?? "http://10.0.2.2:8080";

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
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        "Dizaster usa tu ubicación solo cuando reportas un incidente, para comprobar que estás en el lugar. Tu ubicación exacta no se publica.",
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
    permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
    blockedPermissions: ["ACCESS_BACKGROUND_LOCATION"],
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
        locationWhenInUsePermission:
          "Dizaster usa tu ubicación solo cuando reportas un incidente, para comprobar que estás en el lugar. Tu ubicación exacta no se publica.",
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    "@maplibre/maplibre-react-native",
  ],
  experiments: { typedRoutes: false },
  extra: { apiUrl, linkDomain: linkDomain ?? null },
};

export default config;
