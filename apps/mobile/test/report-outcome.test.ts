import { describe, expect, it } from "vitest";
import { outcomeLines } from "../src/lib/report/outcome";

const msgs: Record<string, string> = {
  created: "Creado", attached: "Sumado", downgraded: "Bajó a post", rejected: "Rechazado",
  why_LOW_ACCURACY: "GPS impreciso", why_MOCK_LOCATION: "Ubicación simulada", rejected_OFFICIAL_ONLY: "Solo oficiales",
};
const t = (k: string) => msgs[k] as string;

describe("outcomeLines (§8.2)", () => {
  it("explica cada motivo una vez e ignora los desconocidos", () => {
    const r = { outcome: "DOWNGRADED_TO_POST", postId: "p", reasons: ["LOW_ACCURACY", "MOCK_LOCATION", "LOW_ACCURACY", "NEW_REASON"] } as never;
    expect(outcomeLines(r, t as never)).toEqual(["Bajó a post", "GPS impreciso", "Ubicación simulada"]);
  });
  it("traduce el rechazo por código y cae al texto del servidor si no lo conoce", () => {
    expect(outcomeLines({ outcome: "REJECTED", code: "OFFICIAL_ONLY", reason: "x" }, t as never)).toEqual(["Rechazado", "Solo oficiales"]);
    expect(outcomeLines({ outcome: "REJECTED", code: "INVALID_CATEGORY", reason: "Categoría no válida" }, t as never)).toEqual(["Rechazado", "Categoría no válida"]);
  });
  it("éxitos en una línea", () => {
    expect(outcomeLines({ outcome: "CREATED_EVENT", reportId: "r", postId: "p", eventId: "e", presenceBand: "ON_SITE" } as never, t as never)).toEqual(["Creado"]);
  });
});
