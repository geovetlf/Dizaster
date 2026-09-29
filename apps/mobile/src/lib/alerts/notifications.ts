import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { api } from "../api";
import { lang } from "../i18n";
import { devicePrefsPatch, routeForNotificationUrl } from "./logic";

/** Con la app abierta el aviso también se muestra (en ambas plataformas), sin sonido: la persona ya está mirando. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

function open(response: Notifications.NotificationResponse | null): void {
  if (!response) return;
  const route = routeForNotificationUrl(response.notification.request.content.data?.["url"]);
  Notifications.clearLastNotificationResponse();
  if (route) router.push(route);
  void refreshUnread();
}

/**
 * Deep link desde el aviso hasta el EVENT, igual en iOS y Android: con la app abierta, en segundo plano o
 * cerrada (el toque que la arrancó se recupera al montar la navegación).
 */
export function useNotificationRouting(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    open(Notifications.getLastNotificationResponse());
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    const received = Notifications.addNotificationReceivedListener(() => void refreshUnread());
    const foreground = AppState.addEventListener("change", (s) => { if (s === "active") void refreshUnread(); });
    void refreshUnread();
    void syncDevicePrefs();
    return () => { tapped.remove(); received.remove(); foreground.remove(); };
  }, [ready]);
}

// Contador de alertas sin leer, compartido por la campana y el historial.
let unread = 0;
const listeners = new Set<() => void>();
function setUnread(n: number): void {
  if (n === unread) return;
  unread = n;
  for (const l of listeners) l();
  Notifications.setBadgeCountAsync(n).catch(() => undefined);
}

export async function refreshUnread(): Promise<void> {
  try {
    setUnread((await api.notifications(null, 1)).unread);
  } catch {
    // Sin conexión o sin sesión: se mantiene el último valor conocido.
  }
}

export const reportUnread = setUnread;

export function useUnreadAlerts(): number {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => unread);
}

/** Horas de silencio e idioma de los avisos siguen al teléfono (viajes, cambio de idioma) sin que la persona haga nada. */
async function syncDevicePrefs(): Promise<void> {
  try {
    const prefs = await api.alertPreferences();
    const patch = devicePrefsPatch(prefs, { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, lang });
    if (patch) await api.updateAlertPreferences(patch);
  } catch {
    // Se reintenta en el próximo arranque.
  }
}
