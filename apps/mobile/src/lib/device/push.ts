import * as Notifications from "expo-notifications";
import { Linking, Platform } from "react-native";
import { permissionView, type PermissionView } from "../alerts/logic";
import { api } from "../api";
import { APNS_MODE } from "../config";
import { toPushRegistration } from "./push-token";

/** Canal Android equivalente a las alertas de iOS. Se crea al inicio para que el aviso de permiso funcione en Android 13+. */
export async function ensureAlertChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("alerts", {
    name: "Alertas",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function register(deviceId: string): Promise<boolean> {
  const reg = toPushRegistration(await Notifications.getDevicePushTokenAsync(), APNS_MODE);
  if (!reg) return false;
  await api.registerPushToken(deviceId, reg);
  return true;
}

/**
 * Registra el token solo si el usuario ya dio permiso. El permiso se pide en contexto (al activar alertas de
 * una zona), nunca al abrir la app: así lo recomiendan Apple y Google y mejora la tasa de aceptación.
 */
export async function registerPushIfPermitted(deviceId: string): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted ? register(deviceId) : false;
}

/** Pide permiso (iOS y Android 13+) y registra el token. Se usa desde la pantalla de alertas. */
export async function enablePush(deviceId: string): Promise<boolean> {
  await ensureAlertChannel();
  const { granted } = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
  return granted ? register(deviceId) : false;
}

/** El sistema puede rotar el token (APNs y FCM): se vuelve a registrar sin intervención del usuario. */
export function watchPushTokenRotation(deviceId: string): () => void {
  const sub = Notifications.addPushTokenListener((token) => {
    const reg = toPushRegistration(token, APNS_MODE);
    if (reg) api.registerPushToken(deviceId, reg).catch(() => undefined);
  });
  return () => sub.remove();
}

/** Estado actual del permiso de notificaciones (sin preguntar). */
export async function pushPermission(): Promise<PermissionView> {
  return permissionView(await Notifications.getPermissionsAsync());
}

/**
 * Tras un rechazo definitivo el sistema ya no muestra el diálogo (iOS nunca repite; Android 13+ tras dos
 * rechazos): la única vía es abrir los ajustes de la app, en ambas plataformas.
 */
export function openSystemSettings(): Promise<void> {
  return Linking.openSettings();
}
