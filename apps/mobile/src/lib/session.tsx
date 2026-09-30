import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { router } from "expo-router";
import { Platform } from "react-native";

/** Evita abrir la pantalla de MFA varias veces si fallan varias peticiones a la vez. */
let mfaOpen = false;
import { api, onSessionEvents, setSession, type TokenPair } from "./api";
import { startupPlan } from "./auth/sign-in-flow";
import { registerReportQueueTask } from "./report/background";
import { cleanOrphanMedia } from "./report/draft-store";
import { ensureAlertChannel, registerPushIfPermitted, watchPushTokenRotation } from "./device/push";
import { registerSigningKey } from "./device/signing-key";
import { clearIdentity, loadIdentity, saveIdentity, type StoredIdentity } from "./device/secure-session";
import { hardwareId } from "./device/hardware-id";
import { newId } from "./ids";
import { startAutoFlush } from "./report/outbox";
import { wipeThisDevice } from "./account/wipe-device";

interface SessionState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
  /** Sin sesión y sin acceso de desarrollo: hay que iniciar sesión (ADR 0171). Emergencias funciona igual. */
  needsSignIn?: boolean;
}

interface SessionContextValue extends SessionState {
  /** Tras borrar la cuenta: olvida la identidad de este teléfono, borra lo que dejó (ADR 0211) y empieza de cero. */
  forgetAndRestart: () => Promise<void>;
  /** Cerrar sesión en este teléfono (ADR 0211): revoca la sesión en el servidor si hay red y hace lo mismo. */
  signOut: () => Promise<void>;
  /** Tras entrar con correo (o Apple/Google): guarda la identidad y arranca la sesión como en cada inicio. */
  completeSignIn: (pair: TokenPair & { deviceId: string | null }) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  ready: false, deviceId: null, error: null, forgetAndRestart: async () => undefined, signOut: async () => undefined, completeSignIn: async () => undefined,
});

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
      identity.current = { handle, deviceId: s.deviceId, refreshToken: s.refreshToken, method: "DEV" };
      persist({});
      return s.deviceId;
    }
    /** Acceso de desarrollo; si el servidor no lo tiene (producción), toca iniciar sesión de verdad. */
    async function devOrSignIn(handle: string, deviceId: string | null | undefined): Promise<string | null | "SIGN_IN"> {
      try {
        return await signIn(handle, deviceId);
      } catch (e) {
        if ((e as { status?: number }).status === 404) return "SIGN_IN";
        throw e;
      }
    }

    onSessionEvents({
      rotated: (refreshToken) => persist({ refreshToken }),
      // El refresh caducó o fue revocado: se vuelve a entrar con la misma identidad del teléfono.
      // Moderación o administración pide el segundo factor (ADR 0090).
      mfa: () => { if (!mfaOpen) { mfaOpen = true; router.push("/mfa"); setTimeout(() => { mfaOpen = false; }, 3000); } },
      lost: () => {
        const id = identity.current;
        if (!id) return;
        // Una cuenta real no vuelve a entrar sola: se pide iniciar sesión otra vez.
        if (id.method === "REAL") { setSession(null); setState((st) => ({ ...st, needsSignIn: true })); return; }
        void signIn(id.handle, id.deviceId).catch(() => undefined);
      },
    });

    (async () => {
      const stored = await loadIdentity();
      let deviceId: string | null | "SIGN_IN";
      const plan = startupPlan(stored);
      if (plan === "REFRESH" && stored) {
        identity.current = stored;
        try {
          setSession(await api.refresh(stored.refreshToken!).then((pair) => { persist({ refreshToken: pair.refreshToken }); return pair; }));
          deviceId = stored.deviceId;
        } catch (e) {
          const status = (e as { status?: number }).status;
          // Sin red se sigue con lo guardado; con el refresh rechazado, una cuenta real vuelve a iniciar sesión.
          if (status === undefined) deviceId = stored.deviceId;
          else deviceId = stored.method === "REAL" ? "SIGN_IN" : await devOrSignIn(stored.handle, stored.deviceId);
        }
      } else if (plan === "SIGN_IN") {
        identity.current = stored;
        deviceId = "SIGN_IN";
      } else {
        deviceId = await devOrSignIn(stored?.handle ?? `dev_${newId().slice(-8)}`, stored?.deviceId);
      }
      if (deviceId === "SIGN_IN") {
        setState({ ready: true, deviceId: stored?.deviceId ?? null, error: null, needsSignIn: true });
        return;
      }
      setState({ ready: true, deviceId, error: null });
      // Reportes guardados sin conexión: se envían en cuanto hay sesión y cada vez que la app vuelve al frente.
      stopFlush = startAutoFlush();
      // Fotos y videos locales sin reporte ni borrador (ADR 0191).
      void cleanOrphanMedia().catch(() => 0);
      void registerReportQueueTask().catch(() => undefined);
      if (deviceId) {
        await ensureAlertChannel().catch(() => undefined);
        await registerPushIfPermitted(deviceId).catch(() => false);
        // Sin conexión no pasa nada: se reintenta en el próximo inicio; los reportes se firman igual (ADR 0129).
        void registerSigningKey(deviceId).catch(() => undefined);
        stopWatching = watchPushTokenRotation(deviceId);
      }
    })().catch((e: Error) => setState({ ready: true, deviceId: null, error: e.message }));
    return () => { stopWatching?.(); stopFlush?.(); onSessionEvents({}); };
  }, [generation]);

  const forgetAndRestart = useCallback(async () => {
    setSession(null);
    identity.current = null;
    await clearIdentity().catch(() => undefined);
    // Cola de reportes (con ubicación precisa), borrador, errores, caché de lectura y copias exportadas eran de esa
    // cuenta: con otra cuenta, los reportes en cola saldrían a su nombre (ADR 0211).
    await wipeThisDevice().catch(() => undefined);
    setState({ ready: false, deviceId: null, error: null });
    setGeneration((g) => g + 1);
  }, []);

  const signOut = useCallback(async () => {
    const refresh = identity.current?.refreshToken;
    // Sin red no se puede revocar: la sesión caduca sola en el servidor y este teléfono ya no guarda el token.
    if (refresh) await api.logout(refresh).catch(() => undefined);
    await forgetAndRestart();
  }, [forgetAndRestart]);

  const completeSignIn = useCallback(async (pair: TokenPair & { deviceId: string | null }) => {
    setSession(pair);
    const next: StoredIdentity = { handle: "", deviceId: pair.deviceId, refreshToken: pair.refreshToken, method: "REAL" };
    identity.current = next;
    await saveIdentity(next).catch(() => undefined);
    // Vuelve a arrancar: renueva con el refresh nuevo, registra push y firma, y envía lo pendiente.
    setState({ ready: false, deviceId: null, error: null });
    setGeneration((g) => g + 1);
  }, []);

  return <SessionContext.Provider value={{ ...state, forgetAndRestart, signOut, completeSignIn }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
