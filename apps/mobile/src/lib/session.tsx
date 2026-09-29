import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { Platform } from "react-native";

/** Evita abrir la pantalla de MFA varias veces si fallan varias peticiones a la vez. */
let mfaOpen = false;
import { api, onSessionEvents, setSession } from "./api";
import { ensureAlertChannel, registerPushIfPermitted, watchPushTokenRotation } from "./device/push";
import { clearIdentity, loadIdentity, saveIdentity, type StoredIdentity } from "./device/secure-session";
import { hardwareId } from "./device/hardware-id";
import { newId } from "./ids";
import { readCache } from "./offline/sqlite-cache";
import { startAutoFlush } from "./report/outbox";

interface SessionState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
}

interface SessionContextValue extends SessionState {
  /** Tras borrar la cuenta: olvida la identidad de este teléfono y empieza de cero. */
  forgetAndRestart: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({ ready: false, deviceId: null, error: null, forgetAndRestart: async () => undefined });

/**
 * Sesión. En esta etapa solo existe el login de desarrollo (el servidor lo bloquea en producción).
 * Apple, Google y email llegan con la Identity Layer completa. La identidad del dispositivo y el refresh
 * rotatorio se guardan en Keychain/Keystore: cada arranque renueva la sesión existente en iOS y en Android,
 * y solo si ya no sirve se vuelve a entrar.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: false, deviceId: null, error: null });
  const [generation, setGeneration] = useState(0);
  const identity = useRef<StoredIdentity | null>(null);

  useEffect(() => {
    let stopWatching: (() => void) | undefined;
    let stopFlush: (() => void) | undefined;
    const platform = Platform.OS === "ios" ? "IOS" : "ANDROID";
    const persist = (patch: Partial<StoredIdentity>) => {
      if (!identity.current) return;
      identity.current = { ...identity.current, ...patch };
      saveIdentity(identity.current).catch(() => undefined);
    };

    async function signIn(handle: string, deviceId: string | null | undefined) {
      const s = await api.devSignIn(handle, platform, deviceId, await hardwareId());
      setSession(s);
      identity.current = { handle, deviceId: s.deviceId, refreshToken: s.refreshToken };
      persist({});
      return s.deviceId;
    }

    onSessionEvents({
      rotated: (refreshToken) => persist({ refreshToken }),
      // El refresh caducó o fue revocado: se vuelve a entrar con la misma identidad del teléfono.
      // Moderación o administración pide el segundo factor (ADR 0090).
      mfa: () => { if (!mfaOpen) { mfaOpen = true; router.push("/mfa"); setTimeout(() => { mfaOpen = false; }, 3000); } },
      lost: () => { if (identity.current) void signIn(identity.current.handle, identity.current.deviceId).catch(() => undefined); },
    });

    (async () => {
      const stored = await loadIdentity();
      let deviceId: string | null;
      if (stored?.refreshToken) {
        identity.current = stored;
        try {
          setSession(await api.refresh(stored.refreshToken).then((pair) => { persist({ refreshToken: pair.refreshToken }); return pair; }));
          deviceId = stored.deviceId;
        } catch {
          deviceId = await signIn(stored.handle, stored.deviceId);
        }
      } else {
        deviceId = await signIn(stored?.handle ?? `dev_${newId().slice(-8)}`, stored?.deviceId);
      }
      setState({ ready: true, deviceId, error: null });
      // Reportes guardados sin conexión: se envían en cuanto hay sesión y cada vez que la app vuelve al frente.
      stopFlush = startAutoFlush();
      if (deviceId) {
        await ensureAlertChannel().catch(() => undefined);
        await registerPushIfPermitted(deviceId).catch(() => false);
        stopWatching = watchPushTokenRotation(deviceId);
      }
    })().catch((e: Error) => setState({ ready: true, deviceId: null, error: e.message }));
    return () => { stopWatching?.(); stopFlush?.(); onSessionEvents({}); };
  }, [generation]);

  const forgetAndRestart = useCallback(async () => {
    setSession(null);
    identity.current = null;
    await clearIdentity().catch(() => undefined);
    // Lo guardado para leer sin conexión (avisos, eventos) era de la cuenta borrada.
    await readCache().clear().catch(() => undefined);
    setState({ ready: false, deviceId: null, error: null });
    setGeneration((g) => g + 1);
  }, []);

  return <SessionContext.Provider value={{ ...state, forgetAndRestart }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
