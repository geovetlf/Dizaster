import { useEffect, useState } from "react";
import { api } from "../api";
import { setPreferredCountry } from "../geo/preferred-country";
import { setUnits } from "../ui/format";

let cached: Promise<{ handle: string; roles: string[] }> | null = null;

/** Handle y roles de la sesión, pedidos una vez por arranque (para no mostrar "bloquear" sobre uno mismo, etc.). */
function load() {
  cached ??= Promise.all([api.me(), api.account()])
    .then(([me, acc]) => { setUnits(me.units); setPreferredCountry(me.country); return { handle: me.handle, roles: acc.roles }; })
    .catch((e: unknown) => { cached = null; throw e; });
  return cached;
}

export function useMe(): { handle: string | null; roles: string[] } {
  const [me, setMe] = useState<{ handle: string | null; roles: string[] }>({ handle: null, roles: [] });
  useEffect(() => {
    let live = true;
    load().then((m) => { if (live) setMe(m); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return me;
}

/** Tras editar el perfil: la próxima lectura vuelve a pedirlo. */
export function forgetMe() { cached = null; }
