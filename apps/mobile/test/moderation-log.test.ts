import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGS } from "../src/lib/i18n";

// ADR 0239: administración ve quién moderó cada acción.
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
describe("registro de moderación", () => {
  it("pantalla registrada y solo visible para administración", () => {
    expect(read("app/_layout.tsx")).toContain('name="admin-moderation-log"');
    expect(read("app/(tabs)/profile.tsx")).toMatch(/can\(roles, "admin"\) \? <Row icon="gavel"[^\n]*admin-moderation-log/);
    expect(read("app/admin-moderation-log.tsx")).toContain("moderatorHandle");
  });
  it("textos en los cuatro idiomas", () => {
    for (const c of Object.values(CATALOGS)) for (const k of ["adminModerationLog", "moderationLogFilter", "moderationLogEmpty", "moderationLogAutomatic"] as const) expect(c[k].length).toBeGreaterThan(3);
  });
});
