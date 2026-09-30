import { describe, expect, it } from "vitest";

// Retención de respaldos (ADR 0189). NO AI REQUIRED.
type Fn = (names: string[], o: { keepLast: number; keepWeeks: number }) => string[];
const load = async () => {
  const url = new URL("../../../scripts/backup-retention.mjs", import.meta.url).href;
  return ((await import(/* @vite-ignore */ url)) as { backupsToDelete: Fn }).backupsToDelete;
};
const day = (d: string) => `dizaster-${d.replaceAll("-", "")}T030000Z.dump.age`;

describe("retención de respaldos", () => {
  it("conserva los últimos N y el más reciente de cada semana; ignora otros archivos", async () => {
    const backupsToDelete = await load();
    // 21 días seguidos (2026-09-10 jueves … 2026-09-30 miércoles).
    const names = Array.from({ length: 21 }, (_, i) => day(new Date(Date.UTC(2026, 8, 10 + i)).toISOString().slice(0, 10)));
    const all = [...names, "notas.txt", `${names[0]}.sha256`, "dizaster-20260101T000000Z.dump.partial"];
    const doomed = backupsToDelete(all, { keepLast: 7, keepWeeks: 3 });
    const kept = names.filter((n) => !doomed.includes(n));
    // Últimos 7 (24–30) + el más reciente de cada una de las 3 últimas semanas (28/9, 21/9, 14/9): 30, 27 y 20.
    expect(kept.map((n) => n.slice(9, 17)).sort()).toEqual(["20260920", "20260924", "20260925", "20260926", "20260927", "20260928", "20260929", "20260930"]);
    expect(doomed.every((n) => /^dizaster-\d{8}T\d{6}Z\.dump(\.age)?$/.test(n))).toBe(true);
  });

  it("nunca borra el más reciente", async () => {
    const backupsToDelete = await load();
    expect(backupsToDelete([day("2026-09-29"), day("2026-09-30")], { keepLast: 0, keepWeeks: 0 })).toEqual([day("2026-09-29")]);
  });
});
