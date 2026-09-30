/**
 * Cortocircuito para proveedores externos (ADR 0205). Tras `threshold` fallos seguidos deja de llamar durante una
 * espera que se duplica en cada nueva apertura (hasta `maxCooldownMs`). Al vencer deja pasar una llamada de prueba:
 * si va bien se cierra; si falla, vuelve a abrirse. Así un proveedor caído no retiene cada envío hasta su plazo.
 */
export class CircuitBreaker {
  private failures = 0;
  private openings = 0;
  private openUntil = 0;
  private probing = false;

  constructor(private readonly o: {
    threshold: number; cooldownMs: number; maxCooldownMs: number; now?: () => number;
    onOpen?: (info: { failures: number; cooldownMs: number }) => void; onClose?: () => void;
  }) {}

  private now(): number { return this.o.now ? this.o.now() : Date.now(); }

  get state(): "closed" | "open" | "half-open" {
    if (this.openings === 0 || this.failures < this.o.threshold) return "closed";
    return this.now() < this.openUntil ? "open" : "half-open";
  }

  /** ¿Se puede llamar ahora? Con el circuito medio abierto solo pasa una llamada de prueba a la vez. */
  allow(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "open" || this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    const wasOpen = this.openings > 0 && this.failures >= this.o.threshold;
    this.failures = 0;
    this.openings = 0;
    this.probing = false;
    if (wasOpen) this.o.onClose?.();
  }

  failure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.failures < this.o.threshold) return;
    const cooldownMs = Math.min(this.o.cooldownMs * 2 ** this.openings, this.o.maxCooldownMs);
    this.openings += 1;
    this.openUntil = this.now() + cooldownMs;
    this.o.onOpen?.({ failures: this.failures, cooldownMs });
  }
}
