/**
 * Caché de GET condicionales (ADR 0084). NO AI REQUIRED.
 * Guarda el último cuerpo de cada ruta que trajo `etag`; la siguiente petición manda `If-None-Match` y, si el
 * servidor responde 304, se reutiliza el cuerpo guardado sin volver a descargarlo. Solo en memoria, acotada
 * (se descarta lo menos usado) y se vacía al cambiar de sesión para no mezclar respuestas de dos cuentas.
 */
export class EtagCache {
  private readonly entries = new Map<string, { etag: string; body: unknown }>();
  constructor(private readonly max = 64) {}

  /** Cabeceras condicionales para esta ruta, si hay algo guardado. */
  headers(path: string): Record<string, string> {
    const e = this.entries.get(path);
    return e ? { "if-none-match": e.etag } : {};
  }

  /** Cuerpo guardado tras un 304 (y lo marca como recién usado). */
  hit(path: string): unknown {
    const e = this.entries.get(path);
    if (!e) return undefined;
    this.entries.delete(path);
    this.entries.set(path, e);
    return e.body;
  }

  store(path: string, etag: string | null, body: unknown): void {
    this.entries.delete(path);
    if (!etag) return;
    this.entries.set(path, { etag, body });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }

  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}
