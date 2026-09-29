/**
 * Cost Optimization Layer: todo gasto por uso (IA, SMS, traducción, transcodificación...) pasa por aquí ANTES de
 * gastar. La implementación persistida (presupuestos, avisos de umbral, kill switches remotos) vive en el
 * módulo cost (ADR 0019); los demás módulos solo conocen esta interfaz.
 */
export interface CostGuard {
  /** ¿Se puede gastar `usd` en `key`? Sin presupuesto o con la función apagada: no. */
  check(key: string, usd: number): Promise<boolean>;
  /** Registra el gasto real una vez hecho. */
  record(key: string, usd: number, opts?: { provider?: string; units?: number }): Promise<void>;
  isKilled(feature: string): Promise<boolean>;
}
