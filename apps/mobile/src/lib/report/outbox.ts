import { AppState } from "react-native";
import { sendReport } from "../api";
import { discardLocal } from "../media/capture";
import { uploadMedia } from "../media/upload";
import { ReportQueue, type FlushResult, type QueuedReport } from "./queue";
import { SqliteQueueStorage } from "./sqlite-storage";

/** Cola única de la app: la usan la pantalla de reporte y el reenvío automático. */
export const reportQueue = new ReportQueue(new SqliteQueueStorage());

/** Las copias locales de fotos y videos se borran cuando el reporte sale de la cola (enviado o descartado). */
const cleanUp = (item: QueuedReport) => {
  for (const m of item.media ?? []) discardLocal(m);
};

let inFlight: Promise<FlushResult> | null = null;

/** Envía lo pendiente. Una sola ejecución a la vez: evita subir dos veces la misma foto. */
export function flushReports(): Promise<FlushResult> {
  inFlight ??= reportQueue.flush(sendReport, uploadMedia, cleanUp).finally(() => { inFlight = null; });
  return inFlight;
}

/**
 * Envía un reporte recién guardado y devuelve su respuesta, o null si quedó en cola (sin conexión).
 * Si ya había un envío en curso, espera a que termine y vuelve a intentar para incluir este reporte.
 */
export async function flushUntilSent(clientReportId: string): Promise<FlushResult["byClientId"][string] | null> {
  for (let i = 0; i < 2; i++) {
    const r = await flushReports();
    if (r.byClientId[clientReportId]) return r.byClientId[clientReportId];
    if (!(await reportQueue.pending()).some((p) => p.clientReportId === clientReportId)) return null;
  }
  return null;
}

/** Reenvío automático: al iniciar sesión y cada vez que la app vuelve a primer plano (Android e iOS). */
export function startAutoFlush(): () => void {
  void flushReports().catch(() => undefined);
  const sub = AppState.addEventListener("change", (s) => {
    if (s === "active") void flushReports().catch(() => undefined);
  });
  return () => sub.remove();
}
