import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api } from "../api";
import { exportFileName } from "./export-name";

/**
 * Descarga la copia de mis datos (ADR 0038), la guarda en la caché de la app y abre la hoja de compartir
 * del sistema para que la persona decida dónde conservarla. `outcome`: "shared" o "saved" (sin hoja disponible).
 * `partial`: alguna lista llegó al tope y la copia no tiene todo (ADR 0295); la app lo dice.
 */
export async function exportMyData(now = new Date()): Promise<{ outcome: "shared" | "saved"; partial: boolean }> {
  const data = await api.exportData();
  const partial = (data.truncated ?? []).length > 0;
  const file = new File(Paths.cache, exportFileName(now));
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(data, null, 2));
  if (!(await Sharing.isAvailableAsync())) return { outcome: "saved", partial };
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: exportFileName(now) });
  return { outcome: "shared", partial };
}
