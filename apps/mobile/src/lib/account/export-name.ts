/** Nombre del archivo de la copia: fecha local del teléfono, igual que el adjunto del servidor. */
export function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `dizaster-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}
