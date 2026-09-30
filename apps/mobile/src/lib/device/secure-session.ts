import * as SecureStore from "expo-secure-store";

/**
 * Identidad del dispositivo guardada en el almacén seguro del sistema: Keychain (iOS) y Keystore (Android).
 * Nunca en AsyncStorage ni en SQLite. Solo en este dispositivo: no viaja en copias de seguridad.
 */
export interface StoredIdentity {
  handle: string;
  deviceId: string | null;
  /** Refresh rotatorio (60 días, un solo uso). Solo aquí: nunca en AsyncStorage, SQLite ni registros. */
  refreshToken?: string | null;
  /** DEV: acceso de desarrollo (vuelve a entrar solo). REAL: correo, Apple o Google (ADR 0171). */
  method?: "DEV" | "REAL";
}

const KEY = "dizaster.identity.v1";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function loadIdentity(): Promise<StoredIdentity | null> {
  const raw = await SecureStore.getItemAsync(KEY, OPTIONS).catch(() => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredIdentity>;
    if (typeof v.handle !== "string") return null;
    return {
      handle: v.handle,
      deviceId: typeof v.deviceId === "string" ? v.deviceId : null,
      refreshToken: typeof v.refreshToken === "string" ? v.refreshToken : null,
      method: v.method === "REAL" ? "REAL" : "DEV",
    };
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(identity), OPTIONS);
}

/** Tras borrar la cuenta: este teléfono olvida la identidad y el próximo arranque es una cuenta nueva. */
export async function clearIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, OPTIONS);
}
