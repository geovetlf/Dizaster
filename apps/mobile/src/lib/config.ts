import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; linkDomain?: string | null };

export const API_URL: string = extra.apiUrl ?? "http://10.0.2.2:8080";
export const LINK_DOMAIN: string | null = extra.linkDomain ?? null;
