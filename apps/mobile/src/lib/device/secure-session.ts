import * as SecureStore from "expo-secure-store";

/**
 * Identidad del dispositivo guardada en el almacén seguro del sistema: Keychain (iOS) y Keystore (Android).
 * Nunca en AsyncStorage ni en SQLite. Solo en este dispositivo: no viaja en copias de seguridad.
 */
export interface StoredIdentity {
  handle: string;
  deviceId: string | null;
}

const KEY = "dizaster.identity.v1";
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export async function loadIdentity(): Promise<StoredIdentity | null> {
  const raw = await SecureStore.getItemAsync(KEY, OPTIONS).catch(() => null);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredIdentity>;
    return typeof v.handle === "string" ? { handle: v.handle, deviceId: typeof v.deviceId === "string" ? v.deviceId : null } : null;
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: StoredIdentity): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(identity), OPTIONS);
}
