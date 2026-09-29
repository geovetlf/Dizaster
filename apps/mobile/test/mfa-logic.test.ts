import { describe, expect, it } from "vitest";
import { cleanTotp, groupSecret, isMfaError } from "../src/lib/auth/mfa";

// Segundo factor del personal (ADR 0090). NO AI REQUIRED.
describe("MFA en la app", () => {
  it("reconoce los errores que piden el segundo factor", () => {
    expect(isMfaError({ error: "MFA_REQUIRED" })).toBe(true);
    expect(isMfaError({ error: "MFA_ENROLLMENT_REQUIRED" })).toBe(true);
    expect(isMfaError({ error: "FORBIDDEN" })).toBe(false);
    expect(isMfaError(null)).toBe(false);
  });
  it("limpia el código y agrupa el secreto", () => {
    expect(cleanTotp("123 456 7")).toBe("123456");
    expect(cleanTotp("12-34")).toBe("1234");
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});
