import { describe, expect, it } from "vitest";
import { isExportFileName } from "../src/lib/account/export-name";
import { WIPE_STEPS, wipeLocalUserData, type LocalUserStores } from "../src/lib/account/wipe";

// Al borrar la cuenta o cerrar sesión no queda nada de la cuenta en el teléfono (ADR 0211).
function fakeStores(failing: string[] = []) {
  const done: string[] = [];
  const step = (name: string) => () => {
    if (failing.includes(name)) throw new Error("falla");
    done.push(name);
  };
  const s = Object.fromEntries(WIPE_STEPS.map((k) => [k, step(k)])) as unknown as LocalUserStores;
  return { s, done };
}

describe("limpieza del teléfono", () => {
  it("borra cola, borrador, media pendiente, errores, caché y copias exportadas", async () => {
    const { s, done } = fakeStores();
    expect(await wipeLocalUserData(s)).toEqual([]);
    expect(done).toEqual(["discardQueue", "clearDraft", "clearPendingMedia", "clearErrorLog", "clearReadCache", "clearExports"]);
  });

  it("si un paso falla, los demás se hacen igual y se informa cuál falló", async () => {
    const { s, done } = fakeStores(["clearDraft"]);
    expect(await wipeLocalUserData(s)).toEqual(["clearDraft"]);
    expect(done).toHaveLength(WIPE_STEPS.length - 1);
    expect(done).toContain("discardQueue");
  });

  it("reconoce solo las copias exportadas por la app", () => {
    expect(isExportFileName("dizaster-export-2026-09-30.json")).toBe(true);
    expect(isExportFileName("categories.json")).toBe(false);
    expect(isExportFileName("dizaster-export-2026-09-30.json.bak")).toBe(false);
  });
});
