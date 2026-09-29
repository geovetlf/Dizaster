import { describe, expect, it } from "vitest";
import config from "../app.config";
import { toPushRegistration } from "../src/lib/device/push-token";

/**
 * Paridad iOS/Android: cada capacidad que la app usa debe estar declarada en las dos plataformas, y lo que
 * V1 no usa (ubicación en segundo plano) debe estar ausente en las dos. Si alguien añade un permiso solo en
 * una plataforma, esta prueba falla.
 */
const CAPABILITIES = [
  { name: "ubicación mientras se usa", ios: "NSLocationWhenInUseUsageDescription", android: "ACCESS_FINE_LOCATION" },
  { name: "cámara", ios: "NSCameraUsageDescription", android: "CAMERA" },
  { name: "micrófono (video)", ios: "NSMicrophoneUsageDescription", android: "RECORD_AUDIO" },
] as const;

const BOTH_ABSENT = [
  { name: "ubicación siempre", ios: ["NSLocationAlwaysUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription"], android: "ACCESS_BACKGROUND_LOCATION" },
] as const;

const plist = (config.ios?.infoPlist ?? {}) as Record<string, unknown>;
const androidPerms = config.android?.permissions ?? [];
const blocked = config.android?.blockedPermissions ?? [];
const pluginNames = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));

describe("paridad de plataformas", () => {
  it("V1 compila solo para iOS y Android", () => {
    expect(config.platforms).toEqual(["ios", "android"]);
  });

  it("mismo identificador de app en ambas tiendas", () => {
    expect(config.ios?.bundleIdentifier).toBe(config.android?.package);
  });

  for (const c of CAPABILITIES) {
    it(`${c.name}: declarada en iOS y Android`, () => {
      expect(typeof plist[c.ios]).toBe("string");
      expect((plist[c.ios] as string).length).toBeGreaterThan(30);
      expect(androidPerms).toContain(c.android);
    });
  }

  for (const c of BOTH_ABSENT) {
    it(`${c.name}: ausente en iOS y bloqueada en Android`, () => {
      for (const k of c.ios) expect(plist[k]).toBeUndefined();
      expect(blocked).toContain(`android.permission.${c.android}`);
    });
  }

  it("notificaciones push configuradas para ambas (APNs y FCM)", () => {
    expect(pluginNames).toContain("expo-notifications");
    expect(androidPerms).toContain("POST_NOTIFICATIONS");
  });

  it("almacenamiento seguro en ambas (Keychain y Keystore)", () => {
    expect(pluginNames).toContain("expo-secure-store");
  });

  it("iOS declara manifiesto de privacidad sin rastreo", () => {
    expect(config.ios?.privacyManifests?.NSPrivacyTracking).toBe(false);
  });

  it("el esquema de enlaces es común a las dos plataformas", () => {
    expect(config.scheme).toBe("dizaster");
  });
});

describe("token push por plataforma", () => {
  it("iOS → APNs con entorno del build", () => {
    expect(toPushRegistration({ type: "ios", data: "a".repeat(64) }, "development")).toEqual({ provider: "APNS", token: "a".repeat(64), environment: "development" });
  });
  it("Android → FCM", () => {
    expect(toPushRegistration({ type: "android", data: "f".repeat(150) }, "development")).toMatchObject({ provider: "FCM" });
  });
  it("tokens web o inválidos se ignoran", () => {
    expect(toPushRegistration({ type: "web", data: { endpoint: "x" } }, "production")).toBeNull();
    expect(toPushRegistration({ type: "ios", data: "short" }, "production")).toBeNull();
  });
});
