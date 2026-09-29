/**
 * Espera a que el servidor termine de procesar una foto recién subida (ADR 0119): la foto de perfil solo se puede
 * fijar cuando ya existe su versión saneada. Lógica pura (sin red ni temporizadores propios) para probarla.
 * NO AI REQUIRED.
 */
export type AvatarReadiness = "READY" | "REJECTED" | "TIMEOUT";

export const AVATAR_POLL_TRIES = 20;
export const AVATAR_POLL_MS = 1000;

export async function waitForProcessed(
  state: () => Promise<string>,
  sleep: (ms: number) => Promise<void>,
  opts: { tries?: number; everyMs?: number } = {},
): Promise<AvatarReadiness> {
  const tries = opts.tries ?? AVATAR_POLL_TRIES;
  for (let i = 0; i < tries; i++) {
    const s = await state();
    if (s === "READY") return "READY";
    if (s === "REJECTED" || s === "DELETED") return "REJECTED";
    if (i < tries - 1) await sleep(opts.everyMs ?? AVATAR_POLL_MS);
  }
  return "TIMEOUT";
}
