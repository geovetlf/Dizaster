import { PUSH_PROVIDER_BY_PLATFORM, type RegisterPushTokenRequest } from "@dizaster/contracts";

/** Token nativo tal como lo entrega el sistema (APNs en iOS, FCM en Android). */
export interface NativePushToken {
  type: string;
  data: unknown;
}

/**
 * Convierte el token nativo en la petición al backend. Lógica común a ambas plataformas: solo cambia el
 * proveedor (APNs/FCM) y, en iOS, el entorno de APNs según el tipo de build.
 */
export function toPushRegistration(token: NativePushToken, apnsMode: "development" | "production"): RegisterPushTokenRequest | null {
  if (typeof token.data !== "string" || token.data.length < 16) return null;
  if (token.type === "ios") return { provider: PUSH_PROVIDER_BY_PLATFORM.IOS, token: token.data, environment: apnsMode };
  if (token.type === "android") return { provider: PUSH_PROVIDER_BY_PLATFORM.ANDROID, token: token.data, environment: "production" };
  return null;
}
