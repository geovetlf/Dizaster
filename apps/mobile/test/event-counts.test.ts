import { describe, expect, it } from "vitest";
import { evidenceCounts } from "../src/lib/events/counts";

// Cabecera del evento con fuentes externas y oficiales por separado (ADR 0117).
const c = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

describe("recuento del evento", () => {
  it("separa externas y oficiales y oculta las que son cero", () => {
    expect(evidenceCounts({ reportCount: 12, sourceCount: 3, officialSourceCount: 1 }, c as never)).toEqual(["12 reports", "2 externalSources", "1 officialSource_one"]);
    expect(evidenceCounts({ reportCount: 1, sourceCount: 0, officialSourceCount: 0 }, c as never)).toEqual(["1 report_one"]);
    expect(evidenceCounts({ reportCount: 0, sourceCount: 1 }, c as never)).toEqual(["0 reports", "1 externalSource_one"]);
  });
  it("un dato incoherente no da números negativos", () => {
    expect(evidenceCounts({ reportCount: 0, sourceCount: 1, officialSourceCount: 5 }, c as never)).toEqual(["0 reports", "1 officialSource_one"]);
  });
});
