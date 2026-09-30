import { Directory, File, Paths } from "expo-file-system";
import { clearErrorLog } from "../errors/error-store";
import { readCache } from "../offline/sqlite-cache";
import { clearDraft, loadDraft } from "../report/draft-store";
import { discardQueuedReport, reportQueue } from "../report/outbox";
import { isExportFileName } from "./export-name";
import { wipeLocalUserData, type LocalUserStores } from "./wipe";

/** Los almacenes reales del teléfono (Android e iOS), para `wipeLocalUserData` (ADR 0211). */
const deviceStores: LocalUserStores = {
  async discardQueue() {
    for (const item of await reportQueue.pending()) await discardQueuedReport(item.clientReportId);
  },
  async clearDraft() {
    await clearDraft({ discardMedia: true, draft: await loadDraft().catch(() => null) });
  },
  clearPendingMedia() {
    const dir = new Directory(Paths.document, "pending-media");
    if (dir.exists) dir.delete();
  },
  clearErrorLog,
  clearReadCache: () => readCache().clear(),
  clearExports() {
    for (const e of new Directory(Paths.cache).list()) if (e instanceof File && isExportFileName(e.name)) e.delete();
  },
};

export const wipeThisDevice = () => wipeLocalUserData(deviceStores);
