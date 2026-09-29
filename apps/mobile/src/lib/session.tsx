import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { api, setToken } from "./api";
import { ensureAlertChannel, registerPushIfPermitted, watchPushTokenRotation } from "./device/push";
import { loadIdentity, saveIdentity } from "./device/secure-session";
import { newId } from "./ids";
import { startAutoFlush } from "./report/outbox";

interface SessionState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
}

const SessionContext = createContext<SessionState>({ ready: false, deviceId: null, error: null });

/**
 * Sesión. En esta etapa solo existe el login de desarrollo (el servidor lo bloquea en producción).
 * Apple, Google y email llegan con la Identity Layer completa. La identidad del dispositivo se guarda en
 * Keychain/Keystore para que cada arranque reutilice el mismo dispositivo en iOS y en Android.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: false, deviceId: null, error: null });
  useEffect(() => {
    let stopWatching: (() => void) | undefined;
    let stopFlush: (() => void) | undefined;
    const platform = Platform.OS === "ios" ? "IOS" : "ANDROID";
    (async () => {
      const stored = await loadIdentity();
      const handle = stored?.handle ?? `dev_${newId().slice(-8)}`;
      const s = await api.devSignIn(handle, platform, stored?.deviceId);
      setToken(s.token);
      await saveIdentity({ handle, deviceId: s.deviceId }).catch(() => undefined);
      setState({ ready: true, deviceId: s.deviceId, error: null });
      // Reportes guardados sin conexión: se envían en cuanto hay sesión y cada vez que la app vuelve al frente.
      stopFlush = startAutoFlush();
      if (s.deviceId) {
        await ensureAlertChannel().catch(() => undefined);
        await registerPushIfPermitted(s.deviceId).catch(() => false);
        stopWatching = watchPushTokenRotation(s.deviceId);
      }
    })().catch((e: Error) => setState({ ready: true, deviceId: null, error: e.message }));
    return () => { stopWatching?.(); stopFlush?.(); };
  }, []);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
