import { describe, expect, it } from "vitest";
import { exportFileName } from "../src/lib/account/export-name";

describe("exportFileName", () => {
  it("usa la fecha local con ceros a la izquierda", () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe("dizaster-export-2026-01-05.json");
  });
});
