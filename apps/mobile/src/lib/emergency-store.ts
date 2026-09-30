import { EmergencyDataset, EmergencyNumbersResponse, compareDatasetVersions } from "@dizaster/contracts";
import { File, Paths } from "expo-file-system";
import { API_URL } from "./config";
import { newestDataset } from "./emergency";
import { fetchWithTimeout } from "./async/timeout";

// Dataset empaquetado: los números funcionan sin conexión desde la primera apertura.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundled = require("../reference-data/emergency-numbers.json") as EmergencyDataset;

const file = () => new File(Paths.document, "emergency-numbers.json");

/** Dataset vigente en el teléfono: el descargado si es más nuevo que el empaquetado. Nunca necesita red. */
export async function localEmergencyDataset(): Promise<EmergencyDataset> {
  try {
    const f = file();
    if (!f.exists) return bundled;
    const parsed = EmergencyDataset.safeParse(JSON.parse(await f.text()));
    return newestDataset(bundled, parsed.success ? parsed.data : null);
  } catch {
    return bundled;
  }
}

/**
 * Pregunta al servidor con la versión local (ADR 0039). Si hay una más nueva la guarda y la devuelve; si no, null.
 * Sin sesión: los datos de referencia son públicos. Cualquier fallo deja el dataset local intacto.
 */
export async function refreshEmergencyDataset(): Promise<EmergencyDataset | null> {
  const current = await localEmergencyDataset();
  try {
    const res = await fetchWithTimeout(`${API_URL}/v1/reference/emergency-numbers?since=${encodeURIComponent(current.version)}`);
    if (!res.ok) return null;
    const body = EmergencyNumbersResponse.safeParse(await res.json());
    if (!body.success || body.data.unchanged || compareDatasetVersions(body.data.version, current.version) <= 0) return null;
    const next: EmergencyDataset = { version: body.data.version, numbers: body.data.numbers, routes: body.data.routes };
    const f = file();
    if (f.exists) f.delete();
    f.create();
    f.write(JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}
