/** Nombre del archivo de la copia: fecha local del teléfono, igual que el adjunto del servidor. */
export function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `dizaster-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/** ¿Es una copia exportada por la app? (para borrarla al cerrar sesión o borrar la cuenta, ADR 0211). */
export function isExportFileName(name: string): boolean {
  return /^dizaster-export-\d{4}-\d{2}-\d{2}\.json$/.test(name);
}
