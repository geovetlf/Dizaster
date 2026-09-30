import { z } from "zod";
import { DevicePlatform } from "./device.js";

/** Inicio de sesión real: Apple, Google y correo con código (§5.1, D-11, ADR 0170). */
const DeviceFields = {
  platform: DevicePlatform.optional(),
  deviceId: z.uuid().optional(),
  /** Resumen (hash) del identificador de instalación del sistema, calculado en el teléfono (ADR 0068). */
  hardwareId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional(),
};

export const IdTokenSignInRequest = z.object({ idToken: z.string().min(20).max(8192), ...DeviceFields });
export type IdTokenSignInRequest = z.infer<typeof IdTokenSignInRequest>;

export const EmailAddress = z.string().trim().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "correo inválido");
export const EmailStartRequest = z.object({ email: EmailAddress });
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;
export const EmailCode = z.string().regex(/^\d{6}$/, "el código tiene 6 dígitos");
export const EmailVerifyRequest = z.object({ email: EmailAddress, code: EmailCode, ...DeviceFields });
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

export const LinkIdentityRequest = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("APPLE"), idToken: z.string().min(20).max(8192) }),
  z.object({ provider: z.literal("GOOGLE"), idToken: z.string().min(20).max(8192) }),
  z.object({ provider: z.literal("EMAIL"), email: EmailAddress, code: EmailCode }),
]);
export type LinkIdentityRequest = z.infer<typeof LinkIdentityRequest>;

/** Qué métodos ofrece el servidor (los apagados no se muestran en la app). */
export const AuthProviders = z.object({ apple: z.boolean(), google: z.boolean(), email: z.boolean() });
export type AuthProviders = z.infer<typeof AuthProviders>;
