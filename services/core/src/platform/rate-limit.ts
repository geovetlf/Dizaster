/**
 * Límite de peticiones en memoria por ventana fija (ADR 0047). Protege la API de ráfagas y enumeración sin
 * servicios extra; con varias instancias cada una limita por su cuenta (Redis llegará en la etapa 1 de escala).
 */
export class FixedWindowLimiter {
  private window = 0;
  private counts = new Map<string, number>();

  constructor(
    readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Cuenta un intento. Devuelve los segundos hasta la próxima ventana si se pasa del límite, o null. */
  hit(key: string): number | null {
    const t = this.now();
    const w = Math.floor(t / this.windowMs);
    if (w !== this.window) {
      // Ventana nueva: se olvida todo (memoria acotada al número de claves activas en un minuto).
      this.window = w;
      this.counts = new Map();
    }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    if (n <= this.limit) return null;
    return Math.max(1, Math.ceil(((w + 1) * this.windowMs - t) / 1000));
  }
}
