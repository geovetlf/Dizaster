/** Estado de red reducido a lo que importa para la cola (ADR 0190). NO AI REQUIRED. */
export interface NetState { isConnected?: boolean; isInternetReachable?: boolean }

/** Con red = conectado y sin evidencia de que internet no llega (`isInternetReachable` puede venir sin saber). */
export const online = (s: NetState | null | undefined) => s?.isConnected === true && s.isInternetReachable !== false;

/** Solo al pasar de sin red a con red se fuerza un envío: el resto de cambios (Wi-Fi ↔ datos) no reintenta en bucle. */
export const cameOnline = (prev: NetState | null, next: NetState) => online(next) && !online(prev);
