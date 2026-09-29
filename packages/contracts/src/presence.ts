import { z } from "zod";

/** Señales crudas del dispositivo. El cliente las envía; el servidor decide. */
export const DeviceFix = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative(),
  altitudeM: z.number().nullable().optional(),
  speedMps: z.number().nullable().optional(),
  headingDeg: z.number().nullable().optional(),
  /** Hora del fix GNSS (independiente del reloj del sistema). */
  fixTime: z.iso.datetime({ offset: true }),
  provider: z.enum(["GNSS", "FUSED", "NETWORK", "UNKNOWN"]).default("UNKNOWN"),
});
export type DeviceFix = z.infer<typeof DeviceFix>;

export const PresenceSignals = z.object({
  fix: DeviceFix,
  /** Android Location.isMock() / iOS sourceInformation.isSimulatedBySoftware. null = no disponible. */
  mockLocation: z.boolean().nullable(),
  /** Veredicto de App Attest / Play Integrity verificado en el servidor. El cliente solo envía el token. */
  attestationToken: z.string().max(8192).nullable(),
  /** Fixes previos recientes de la sesión (resumidos) para detectar saltos imposibles. */
  recentFixes: z
    .array(z.object({ lat: z.number(), lng: z.number(), fixTime: z.iso.datetime({ offset: true }) }))
    .max(10)
    .default([]),
  /** Hora del reloj del dispositivo al enviar, para detectar desfases. */
  deviceClock: z.iso.datetime({ offset: true }),
});
export type PresenceSignals = z.infer<typeof PresenceSignals>;

export const PresenceBand = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type PresenceBand = z.infer<typeof PresenceBand>;

export const AttestationVerdict = z.enum(["GENUINE", "FAILED", "UNAVAILABLE"]);
export type AttestationVerdict = z.infer<typeof AttestationVerdict>;
