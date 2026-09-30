/**
 * Particionado mensual preparado (§7.4, ADR 0182). Los ids son UUIDv7: los primeros 48 bits son los milisegundos
 * de creación, así que ordenar por id es ordenar por tiempo y la PK `id` ya contiene la clave de partición. Un
 * `PARTITION BY RANGE (id)` con estos límites parte `event.events` y `report.reports` por mes sin cambiar la PK.
 * No se usa todavía: solo cuando el volumen lo pida (decisión de operación, con el runbook del ADR).
 */

/** El UUIDv7 más pequeño posible para ese instante (versión 7, variante 10, resto a cero). */
export function uuidV7Floor(at: Date): string {
  const hex = Math.max(0, Math.floor(at.getTime())).toString(16).padStart(12, "0");
  if (hex.length > 12) throw new RangeError("Fecha fuera del rango de UUIDv7");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000000`;
}

export interface MonthPartition { suffix: string; from: string; to: string }

/** Meses naturales en UTC desde `start` (incluido), con sus límites de id [from, to). */
export function monthPartitions(start: Date, months: number): MonthPartition[] {
  const out: MonthPartition[] = [];
  for (let i = 0; i < months; i++) {
    const a = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const b = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i + 1, 1));
    out.push({ suffix: `y${a.getUTCFullYear()}m${String(a.getUTCMonth() + 1).padStart(2, "0")}`, from: uuidV7Floor(a), to: uuidV7Floor(b) });
  }
  return out;
}

const IDENT = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

/** DDL de una partición mensual de `table` (esquema.tabla, ya particionada por rango de id). */
export function monthPartitionDdl(table: string, p: MonthPartition): string {
  if (!IDENT.test(table)) throw new Error(`Tabla inválida: ${table}`);
  return `CREATE TABLE IF NOT EXISTS ${table}_${p.suffix} PARTITION OF ${table} FOR VALUES FROM ('${p.from}') TO ('${p.to}')`;
}
