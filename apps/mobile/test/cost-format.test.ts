import { describe, expect, it } from "vitest";
import { barHeights, budgetLabel, budgetTone, formatBytes, formatUnits, formatUsd, moduleRows } from "../src/lib/admin/cost-format";

describe("tablero de costos (formato)", () => {
  it("formatea importes, bytes y unidades", () => {
    expect(formatUsd(null, "es")).toBeNull();
    expect(formatUsd(12.5, "en")).toBe("US$ 12.50");
    expect(formatUsd(0.0045, "en")).toBe("US$ 0.0045");
    expect(formatUsd(0, "en")).toBe("US$ 0.00");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(3 * 1024 ** 2)).toBe("3.0 MB");
    expect(formatUnits(1532)).toBe("1.5k");
    expect(formatUnits(2_400_000)).toBe("2.4M");
  });

  it("ordena módulos y colorea presupuestos por umbral", () => {
    const rows = moduleRows({
      modules: [
        { module: "http", estimatedUsd: 0, metrics: [{ metric: "requests", provider: "events", units: 900, estimatedUsd: 0 }] },
        { module: "ai", estimatedUsd: 3.2, metrics: [{ metric: "spend", provider: "x", units: 10, estimatedUsd: 3.2 }] },
        { module: "geo", estimatedUsd: 0, metrics: [{ metric: "context_lookups", provider: "cache", units: 50, estimatedUsd: 0 }] },
      ],
    });
    expect(rows.map((r) => r.module)).toEqual(["ai", "http", "geo"]);
    expect([null, 10, 50, 80, 100, 130].map(budgetTone)).toEqual(["ok", "ok", "warn", "high", "over", "over"]);
    expect(barHeights([0, 5, 10])).toEqual([0, 0.5, 1]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
  });
  it("nombra los presupuestos conocidos y deja la clave de los nuevos (ADR 0301)", () => {
    const t = (k: string) => `T:${k}`;
    expect(budgetLabel("ai", t)).toBe("T:budgetKey_ai");
    expect(budgetLabel("translation", t)).toBe("T:budgetKey_translation");
    expect(budgetLabel("maps", t)).toBe("maps");
  });
});
