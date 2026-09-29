import * as SecureStore from "expo-secure-store";

/**
 * Recuerda en este teléfono que alguien declaró no tener la edad mínima (ADR 0049), para que la app no le vuelva a
 * ofrecer publicar tras reiniciar. El servidor no guarda nada en ese caso.
 */
const KEY = "dizaster.age-blocked.v1";

export async function isAgeBlocked(): Promise<boolean> {
  return (await SecureStore.getItemAsync(KEY).catch(() => null)) === "1";
}

export async function setAgeBlocked(): Promise<void> {
  await SecureStore.setItemAsync(KEY, "1").catch(() => undefined);
}
