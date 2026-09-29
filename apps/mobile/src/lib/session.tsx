import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Platform } from "react-native";
import { api, setToken } from "./api";
import { newId } from "./ids";

interface SessionState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
}

const SessionContext = createContext<SessionState>({ ready: false, deviceId: null, error: null });

/**
 * Sesión. En esta etapa solo existe el login de desarrollo (el servidor lo bloquea en producción).
 * Apple, Google y email llegan con la Identity Layer completa.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: false, deviceId: null, error: null });
  useEffect(() => {
    const platform = Platform.OS === "ios" ? "IOS" : "ANDROID";
    api
      .devSignIn(`dev_${newId().slice(-8)}`, platform)
      .then((s) => {
        setToken(s.token);
        setState({ ready: true, deviceId: s.deviceId, error: null });
      })
      .catch((e: Error) => setState({ ready: true, deviceId: null, error: e.message }));
  }, []);
  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
