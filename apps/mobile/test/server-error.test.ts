import { describe, expect, it } from "vitest";
import { SERVER_ERROR_KEYS, serverErrorMessage } from "../src/lib/errors/server-error";
import type { MessageKey } from "../src/lib/i18n";

// Errores del servidor traducidos por código (ADR 0105).
const tr = (k: MessageKey) => `[${k}]`;

describe("errores del servidor", () => {
  it("en español usa el mensaje del servidor, que es el más preciso", () => {
    expect(serverErrorMessage({ error: "LIMIT_REACHED", message: "Puedes administrar hasta 3 negocios" }, 409, "es", tr)).toBe("Puedes administrar hasta 3 negocios");
  });

  it("en otros idiomas traduce el código conocido", () => {
    expect(serverErrorMessage({ error: "LIMIT_REACHED", message: "Máximo 5 zonas" }, 409, "en", tr)).toBe("[errLimitReached]");
    expect(serverErrorMessage({ error: "RATE_LIMITED", message: "x" }, 429, "fr", tr)).toBe("[errRateLimited]");
  });

  it("un código desconocido cae al mensaje del servidor y, sin mensaje, al estado HTTP", () => {
    expect(serverErrorMessage({ error: "SPLIT_WOULD_EMPTY", message: "No se puede" }, 409, "pt", tr)).toBe("No se puede");
    expect(serverErrorMessage({}, 429, "en", tr)).toBe("[errRateLimited]");
    expect(serverErrorMessage(null, 502, "es", tr)).toBe("[errInternal]");
    expect(serverErrorMessage({ message: "  " }, 418, "en", tr)).toBe("HTTP 418");
  });

  it("todas las claves del mapa existen en el catálogo", async () => {
    const { t } = await import("../src/lib/i18n");
    for (const key of Object.values(SERVER_ERROR_KEYS)) expect(t(key)).toBeTruthy();
  });
});
