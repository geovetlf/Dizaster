/**
 * Cost Optimization Layer (primer corte): presupuestos y kill switches en proceso.
 * Todo gasto por uso (IA, SMS, traducción, transcodificación...) debe pasar por aquí ANTES de gastar.
 * Siguiente etapa: contadores persistidos y tablero de costo.
 */
export interface CostGuard {
  check(budgetKey: string, units: number): boolean;
  record(budgetKey: string, units: number): void;
  isKilled(feature: string): boolean;
}

export class InMemoryCostGuard implements CostGuard {
  private readonly used = new Map<string, number>();

  constructor(
    private readonly budgets: Record<string, number>,
    private readonly killSwitches: Record<string, boolean> = {},
  ) {}

  check(budgetKey: string, units: number): boolean {
    const budget = this.budgets[budgetKey];
    if (budget === undefined) return false; // sin presupuesto definido no se gasta
    return (this.used.get(budgetKey) ?? 0) + units <= budget;
  }

  record(budgetKey: string, units: number): void {
    this.used.set(budgetKey, (this.used.get(budgetKey) ?? 0) + units);
  }

  isKilled(feature: string): boolean {
    return this.killSwitches[feature] === true;
  }

  snapshot(): Record<string, { used: number; budget: number | undefined }> {
    const out: Record<string, { used: number; budget: number | undefined }> = {};
    for (const key of new Set([...Object.keys(this.budgets), ...this.used.keys()])) {
      out[key] = { used: this.used.get(key) ?? 0, budget: this.budgets[key] };
    }
    return out;
  }
}
