import { z } from "zod";

/** Plataformas de V1. Ambas son de primera clase: ningún contrato puede asumir una sola. */
export const DevicePlatform = z.enum(["IOS", "ANDROID"]);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

/**
 * Push directo, sin intermediarios de pago (Blueprint §4.3): APNs para iOS y FCM para Android.
 * El proveedor debe corresponder a la plataforma del dispositivo.
 */
export const PushProvider = z.enum(["APNS", "FCM"]);
export type PushProvider = z.infer<typeof PushProvider>;

export const PUSH_PROVIDER_BY_PLATFORM: Record<DevicePlatform, PushProvider> = { IOS: "APNS", ANDROID: "FCM" };

export const RegisterPushTokenRequest = z.object({
  provider: PushProvider,
  token: z.string().min(16).max(4096),
  /** Solo APNs distingue entorno (sandbox para builds de desarrollo). */
  environment: z.enum(["development", "production"]).default("production"),
});
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenRequest>;

/**
 * Sesiones abiertas de la cuenta (una por inicio de sesión, aunque el token se renueve). Sin IP ni ubicación:
 * solo plataforma, versión de la app y fechas.
 */
export interface SessionView {
  id: string;
  platform: DevicePlatform | null;
  appVersion: string | null;
  startedAt: string;
  lastActiveAt: string;
  current: boolean;
}
