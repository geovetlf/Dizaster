import { getAndroidId, getIosIdForVendorAsync } from "expo-application";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { Platform } from "react-native";

/**
 * Resumen del identificador de instalación del sistema (Android ID / identifierForVendor), para que varias cuentas en
 * este teléfono cuenten como una al corroborar (ADR 0068). El valor original nunca sale del teléfono: solo su SHA-256,
 * que el servidor vuelve a cifrar con su propia clave. Sin identificador disponible: null (no bloquea nada).
 */
export async function hardwareId(): Promise<string | null> {
  try {
    const raw = Platform.OS === "android" ? getAndroidId() : Platform.OS === "ios" ? await getIosIdForVendorAsync() : null;
    if (!raw) return null;
    return await digestStringAsync(CryptoDigestAlgorithm.SHA256, `dizaster-hw:${raw}`);
  } catch {
    return null;
  }
}
