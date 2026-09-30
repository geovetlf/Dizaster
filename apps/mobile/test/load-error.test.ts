import { describe, expect, it } from "vitest";
import { classifyLoadError } from "../src/lib/errors/load-error";

// Pantallas que no cargan (ADR 0212): borrado o inexistente no se reintenta; sin red, sí.
describe("classifyLoadError", () => {
  it("404 y 410 son contenido que no existe", () => {
    expect(classifyLoadError(Object.assign(new Error("x"), { status: 404 }))).toBe("notFound");
    expect(classifyLoadError({ status: 410 })).toBe("notFound");
  });
  it("sin respuesta del servidor es falta de red", () => {
    expect(classifyLoadError(new TypeError("Network request failed"))).toBe("offline");
    expect(classifyLoadError(null)).toBe("offline");
  });
  it("otros errores del servidor se pueden reintentar", () => {
    expect(classifyLoadError({ status: 500 })).toBe("failed");
    expect(classifyLoadError({ status: 503 })).toBe("failed");
  });
});
