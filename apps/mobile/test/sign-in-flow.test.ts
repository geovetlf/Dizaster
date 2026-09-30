import { describe, expect, it } from "vitest";
import { isEmail, normalizeCode, startupPlan } from "../src/lib/auth/sign-in-flow";

describe("inicio de sesión (ADR 0171)", () => {
  it("valida correo y código", () => {
    expect(isEmail(" ana@correo.pe ")).toBe(true);
    expect(isEmail("ana@correo")).toBe(false);
    expect(isEmail("ana correo@x.pe")).toBe(false);
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("abcdef")).toBeNull();
  });
  it("plan de arranque", () => {
    expect(startupPlan(null)).toBe("DEV");
    expect(startupPlan({ refreshToken: "r" })).toBe("REFRESH");
    expect(startupPlan({ method: "REAL", refreshToken: null })).toBe("SIGN_IN");
    expect(startupPlan({ method: "DEV", refreshToken: null })).toBe("DEV");
  });
});
