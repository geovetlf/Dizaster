import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { hasSession } from "../api";
import { flushReports, reportQueue } from "./outbox";

/**
 * Envío de la cola en segundo plano (ADR 0190, §8.3): el sistema despierta la app cada cierto tiempo (Android:
 * WorkManager con red; iOS: BGTaskScheduler, cuando el sistema decide) y se envía lo pendiente.
 * Solo si la app sigue viva con sesión en memoria: no se renueva el refresh rotatorio desde segundo plano para no
 * competir con la app al abrirse (un refresh usado dos veces cerraría la sesión). Si no, sale al abrir la app.
 */
export const REPORT_QUEUE_TASK = "dizaster.report-queue";

TaskManager.defineTask(REPORT_QUEUE_TASK, async () => {
  try {
    if (!hasSession() || (await reportQueue.pending()).length === 0) return BackgroundTask.BackgroundTaskResult.Success;
    const r = await flushReports();
    return r.failed > 0 ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registro idempotente al arrancar. 15 min es el mínimo que permite Android. */
export async function registerReportQueueTask(): Promise<void> {
  if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(REPORT_QUEUE_TASK)) return;
  await BackgroundTask.registerTaskAsync(REPORT_QUEUE_TASK, { minimumInterval: 15 });
}
