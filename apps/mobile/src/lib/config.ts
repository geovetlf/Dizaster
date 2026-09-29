import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string | null;
  linkDomain?: string | null;
  apnsMode?: "development" | "production";
};

/**
 * Sin DIZASTER_API_URL, cada plataforma apunta al backend local a su manera: el emulador de Android llega al
 * equipo anfitrión por 10.0.2.2 y el simulador de iOS por localhost. Un dispositivo físico necesita la URL real.
 */
const LOCAL_API = Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://localhost:8080";

export const API_URL: string = extra.apiUrl ?? LOCAL_API;
export const LINK_DOMAIN: string | null = extra.linkDomain ?? null;
export const APNS_MODE: "development" | "production" = extra.apnsMode === "production" ? "production" : "development";
