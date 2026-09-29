import { describe, expect, it } from "vitest";
import { detectPersonalData } from "../src/personal-data.js";

// Datos personales (ADR 0088). NO AI REQUIRED.
describe("detectPersonalData", () => {
  it("teléfonos en formatos habituales", () => {
    for (const t of ["Llamen al 987 654 321", "cel: +51 987-654-321", "(01) 234-5678 es su casa", "wsp 987654321"]) {
      expect(detectPersonalData(t), t).toEqual(["PHONE"]);
    }
  });
  it("correo, documento y tarjeta (Luhn)", () => {
    expect(detectPersonalData("escríbele a ana.perez@correo.pe")).toEqual(["EMAIL"]);
    expect(detectPersonalData("su DNI: 45678912 vive ahí")).toEqual(["ID_DOCUMENT", "PHONE"]);
    expect(detectPersonalData("pasaporte AB123456")).toEqual(["ID_DOCUMENT"]);
    expect(detectPersonalData("tarjeta 4111 1111 1111 1111")).toEqual(["PAYMENT_CARD"]);
    // 16 dígitos que no pasan Luhn no son tarjeta ni teléfono (más de 15 dígitos).
    expect(detectPersonalData("pedido 4111 1111 1111 1112")).toEqual([]);
  });
  it("no confunde fechas, horas, magnitudes, coordenadas ni rangos de años", () => {
    for (const t of [
      "Sismo de 7.5 a las 14:05 del 29-09-2026", "2026-09-29 corte de agua", "en -12.0464, -77.0428",
      "-12.0464 -77.0428 zona afectada", "entre 2019-2025 hubo 3 huaicos", "llamen al 105 o al 116", "km 1234",
    ]) expect(detectPersonalData(t), t).toEqual([]);
  });
  it("los números públicos conocidos no cuentan", () => {
    expect(detectPersonalData("línea gratuita 0800-12345", new Set(["080012345"]))).toEqual([]);
    expect(detectPersonalData("línea gratuita 0800-12345")).toEqual(["PHONE"]);
  });
});
