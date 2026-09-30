import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { AppState } from "react-native";
import { sendReport } from "../api";
import { discardLocal } from "../media/capture";
import { uploadMedia } from "../media/upload";
import { cameOnline, type NetState } from "./connectivity";
import { ReportQueue, retryDelayMs, type FlushResult, type QueuedReport } from "./queue";
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

/** Descartar un reporte sin enviar (decisión de la persona): sale de la cola y se borran sus copias locales. */
export async function discardQueuedReport(clientReportId: string): Promise<void> {
  const item = await reportQueue.discard(clientReportId);
  if (item) cleanUp(item);
}

/** Volver a intentar un reporte detenido. */
export async function retryQueuedReport(clientReportId: string): Promise<FlushResult> {
  await reportQueue.retry(clientReportId);
  return flushReports();
}

/**
 * Reenvío automático (ADR 0158, ADR 0190): al iniciar sesión, al volver a primer plano, en cuanto vuelve la red y,
 * mientras la app está abierta y queda algo en cola, con espera creciente (15 s → 5 min). En segundo plano lo
 * retoma la tarea del sistema (`background.ts`). Android e iOS.
 */
export function startAutoFlush(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  const run = () => {
    clear();
    void flushReports().then((r) => {
      if (r.failed > 0 && AppState.currentState === "active") {
        timer = setTimeout(run, retryDelayMs(failures));
        failures++;
      } else {
        failures = 0;
      }
    }).catch(() => undefined);
  };
  run();
  const sub = AppState.addEventListener("change", (s) => {
    if (s === "active") { failures = 0; run(); } else clear();
  });
  // Al volver la red no se espera al siguiente reintento: sale ya.
  let net: NetState | null = null;
  void getNetworkStateAsync().then((s) => { net ??= s; }).catch(() => undefined);
  const netSub = addNetworkStateListener((s) => {
    const back = cameOnline(net, s);
    net = s;
    if (back) { failures = 0; run(); }
  });
  return () => { clear(); sub.remove(); netSub.remove(); };
}
