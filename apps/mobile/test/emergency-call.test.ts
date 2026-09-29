import { readFileSync } from "node:fs";
import { EmergencyDataset, directEmergencyNumber, type EmergencyNumber } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { callTarget } from "../src/lib/emergency";

const dataset = EmergencyDataset.parse(JSON.parse(readFileSync(new URL("../../../data/emergency-numbers/emergency-numbers.json", import.meta.url), "utf8")));
const categories = JSON.parse(readFileSync(new URL("../../../data/categories/categories.json", import.meta.url), "utf8")) as { categories: { code: string; defaultSeverity: number; citizenReportable: boolean }[] };

const num = (o: Partial<EmergencyNumber>): EmergencyNumber => ({
  country: "PE", subdivision: null, service: "GENERAL", number: "999", label: { es: "x" }, source: "t", verification: "VERIFIED", verifiedAt: null, availability: "ALWAYS", ...o,
});

describe("Llamada directa por categoría (ADR 0062)", () => {
  it("en Perú cada categoría grave marca el servicio que le corresponde", () => {
    const n = (c: string) => directEmergencyNumber(dataset, { category: c, country: "PE" })?.number;
    expect(n("fire.structure")).toBe("116");
    expect(n("crime.violence")).toBe("105");
    expect(n("accident.traffic")).toBe("106");
    expect(n("natural.earthquake")).toBe("116");
    expect(n("natural.tsunami")).toBe("115");
  });

  it("con número general único (112/911) se marca ese para cualquier categoría", () => {
    expect(directEmergencyNumber(dataset, { category: "fire.structure", country: "ES" })?.number).toBe("112");
    expect(directEmergencyNumber(dataset, { category: "crime.violence", country: "US" })?.number).toBe("911");
  });

  it("sin número o sin país: lista de emergencias", () => {
    expect(callTarget(dataset, "fire.structure", null)).toEqual({ kind: "list" });
    expect(callTarget(dataset, "fire.structure", "ZZ")).toEqual({ kind: "list" });
    expect(callTarget(dataset, "help.shelter", "PE")).toEqual({ kind: "list" });
    expect(callTarget(dataset, "fire.structure", "PE")).toMatchObject({ kind: "direct", tel: "tel:116" });
  });

  it("toda categoría grave reportable tiene ruta en países con número general", () => {
    const severe = categories.categories.filter((c) => c.citizenReportable && c.defaultSeverity >= 4);
    expect(severe.length).toBeGreaterThan(0);
    for (const c of severe) expect(directEmergencyNumber(dataset, { category: c.code, country: "ES" }), c.code).not.toBeNull();
  });

  it("la regla del país gana a la global, la de subdivisión a la nacional, y no se marca un número de horario limitado", () => {
    const ds = {
      numbers: [num({ service: "FIRE", number: "116" }), num({ service: "POLICE", number: "105" }), num({ service: "FIRE", number: "117", subdivision: "PE-LIM" }), num({ service: "AMBULANCE", number: "118", availability: "LIMITED" })],
      routes: [
        { country: "*" as const, subdivision: null, category: "fire", services: ["FIRE" as const] },
        { country: "PE", subdivision: null, category: "fire.wildfire", services: ["POLICE" as const] },
        { country: "*" as const, subdivision: null, category: "health", services: ["AMBULANCE" as const] },
      ],
    };
    expect(directEmergencyNumber(ds, { category: "fire.structure", country: "PE" })?.number).toBe("116");
    expect(directEmergencyNumber(ds, { category: "fire.structure", country: "PE", subdivision: "PE-LIM" })?.number).toBe("117");
    expect(directEmergencyNumber(ds, { category: "fire.wildfire", country: "PE" })?.number).toBe("105");
    expect(directEmergencyNumber(ds, { category: "health.outbreak", country: "PE" })).toBeNull();
  });

  it("un dataset descargado antes de las rutas sigue siendo válido (sin llamada directa)", () => {
    const old = EmergencyDataset.parse({ version: "emergency-2026.09.1", numbers: [num({})] });
    expect(old.routes).toEqual([]);
    expect(callTarget(old, "fire.structure", "PE")).toEqual({ kind: "list" });
  });
});
