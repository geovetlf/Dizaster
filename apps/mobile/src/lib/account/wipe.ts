/**
 * Lo que la cuenta dejó en el teléfono (ADR 0211). Al borrar la cuenta o cerrar sesión se borra todo: los reportes
 * en cola llevan la ubicación precisa y no tienen dueño, así que con otra cuenta saldrían a su nombre.
 * Cada paso es independiente: si uno falla, los demás se hacen igual. Devuelve los pasos que fallaron.
 * NO AI REQUIRED.
 */
export interface LocalUserStores {
  /** Reportes en cola (enviados o detenidos), con sus fotos y videos locales. */
  discardQueue(): Promise<void>;
  /** Borrador del reporte y su media (ADR 0191). */
  clearDraft(): Promise<void>;
  /** Carpeta de fotos y videos pendientes, por si quedó algo sin referencia. */
  clearPendingMedia(): void;
  /** Registro local de errores (puede llevar rutas y textos de pantalla). */
  clearErrorLog(): void;
  /** Lo guardado para leer sin conexión (avisos, eventos, perfil). */
  clearReadCache(): Promise<void>;
  /** Copias exportadas de mis datos que quedaron en la caché (ADR 0038). */
  clearExports(): void;
}

export const WIPE_STEPS = ["discardQueue", "clearDraft", "clearPendingMedia", "clearErrorLog", "clearReadCache", "clearExports"] as const;

export async function wipeLocalUserData(s: LocalUserStores): Promise<string[]> {
  const failed: string[] = [];
  for (const step of WIPE_STEPS) {
    try {
      await s[step]();
    } catch {
      failed.push(step);
    }
  }
  return failed;
}
