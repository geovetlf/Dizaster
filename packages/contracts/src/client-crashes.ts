import { z } from "zod";

/**
 * Informes de fallos de la app, autoalojados (§5.22, ADR 0173). La app ya los redacta al guardarlos (ADR 0161): sin
 * tokens, correos, coordenadas ni ids. El servidor no los asocia a ninguna cuenta.
 */
export const ClientCrashEntry = z.object({
  at: z.iso.datetime(),
  message: z.string().min(1).max(300),
  where: z.string().max(200).nullable(),
  stack: z.string().max(1500).nullable(),
  requestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});
export type ClientCrashEntry = z.infer<typeof ClientCrashEntry>;

export const ClientCrashReport = z.object({ entries: z.array(ClientCrashEntry).min(1).max(20) });
export type ClientCrashReport = z.infer<typeof ClientCrashReport>;

/** Fallos agrupados por huella (mensaje + primera línea de la pila) en el periodo pedido. */
export interface ClientCrashGroup {
  fingerprint: string;
  message: string;
  where: string | null;
  firstFrame: string | null;
  platforms: string[];
  appVersions: string[];
  count: number;
  firstAt: string;
  lastAt: string;
  lastRequestId: string | null;
}
export interface ClientCrashesResponse { days: number; total: number; groups: ClientCrashGroup[] }
