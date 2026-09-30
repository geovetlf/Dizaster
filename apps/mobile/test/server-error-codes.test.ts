import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVER_ERROR_KEYS } from "../src/lib/errors/server-error";

// Todos los códigos de error del servidor tienen traducción (ADR 0197): en inglés, portugués o francés nunca se
// muestra el mensaje del servidor en español. NO AI REQUIRED.
const SRC = new URL("../../../services/core/src/", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("códigos de error del servidor", () => {
  it("cada código que el servidor puede devolver tiene clave de traducción", () => {
    const codes = new Set<string>();
    // Los resultados de los proveedores de push (`PushResult.error`) quedan en el servidor; nunca llegan a la app.
    for (const f of files(SRC).filter((p) => !p.includes("/modules/alert/push/"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:new DomainError\(\s*|error:\s*)"([A-Z][A-Z0-9_]+)"/g)) codes.add(m[1]!);
    }
    expect(codes.size).toBeGreaterThan(50);
    const missing = [...codes].filter((c) => !SERVER_ERROR_KEYS[c]).sort();
    expect(missing).toEqual([]);
  });
});
