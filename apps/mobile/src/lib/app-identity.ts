import { APP_PLATFORM_HEADER, APP_VERSION_HEADER } from "@dizaster/contracts";
import * as Application from "expo-application";
import { Platform } from "react-native";

/** Plataforma y versión instalada, para exigir la versión mínima al escribir (ADR 0164). */
export const appPlatform: string = Platform.OS;
export const appVersion: string | null = Application.nativeApplicationVersion ?? null;

export const appVersionHeaders: Record<string, string> =
  appVersion && (appPlatform === "android" || appPlatform === "ios") ? { [APP_PLATFORM_HEADER]: appPlatform, [APP_VERSION_HEADER]: appVersion } : {};
