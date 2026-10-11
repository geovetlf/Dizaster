import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as C from "../src/index.js";

/**
 * Compatibilidad hacia atrás de los contratos (ADR 0343). Una app instalada no se actualiza a la vez que el servidor:
 * - Lo que la app ENVÍA (cuerpos y query) no puede ganar un campo obligatorio ni perder un valor de enum: la app vieja
 *   no lo manda y el servidor la rechazaría.
 * - Lo que la app RECIBE no puede perder un campo obligatorio ni volverlo opcional: la app vieja cuenta con él.
 * - Lo que la app VALIDA con zod al recibirlo (catálogo de categorías, números de emergencia) no puede ganar valores de
 *   enum: la app vieja rechazaría el dataset entero y se quedaría con el empaquetado.
 * Se compara contra `compat-baseline.json`. Los cambios compatibles (un campo opcional nuevo, un campo de respuesta
 * nuevo) no fallan. Un cambio incompatible a propósito exige ADR y subir la versión mínima de la app; entonces se
 * regenera la línea base con `CONTRACT_BASELINE=update pnpm --filter @dizaster/contracts test`.
 */
const BASELINE = new URL("./compat-baseline.json", import.meta.url);

/** Respuestas que la app solo tipa (cualquier campo que pierdan rompe a la app vieja). */
const RESPONSES = [
  "AppConfig", "CategoryCatalog", "EmergencyNumbersResponse", "EmergencyDataset", "AttributionsResponse", "SubmitReportResponse",
  "EventMapResponse", "NearbyEventsResponse", "EventSearchResponse", "EventSummary", "EventDetail", "VerificationView",
  "TimelineEntryView", "EventDonationsResponse", "AlertPreferences",
];
/** Respuestas que la app valida con zod en el teléfono: además no pueden ganar valores de enum. */
const VALIDATED_BY_APP = ["CategoryCatalog", "EmergencyNumbersResponse", "EmergencyDataset"];

type Shape = Record<string, string>;
type Js = { type?: string | string[]; properties?: Record<string, Js>; required?: string[]; items?: Js; anyOf?: Js[]; oneOf?: Js[]; enum?: unknown[]; const?: unknown; $ref?: string; additionalProperties?: Js | boolean };

/** Aplana un JSON Schema: "ruta" → "required" | "optional", y "ruta#enum" → valores. Las ramas de una unión se nombran por su discriminante. */
function flatten(js: Js, path: string, out: Shape): void {
  if (js.enum) out[`${path}#enum`] = js.enum.map(String).sort().join("|");
  if (js.properties) {
    for (const [k, v] of Object.entries(js.properties)) {
      out[`${path}.${k}`] = js.required?.includes(k) ? "required" : "optional";
      flatten(v, `${path}.${k}`, out);
    }
  }
  if (js.items) flatten(js.items, `${path}[]`, out);
  if (js.additionalProperties && typeof js.additionalProperties === "object") flatten(js.additionalProperties, `${path}{}`, out);
  for (const [i, opt] of (js.anyOf ?? js.oneOf ?? []).entries()) {
    const disc = Object.entries(opt.properties ?? {}).find(([, p]) => p.const !== undefined);
    const label = disc ? `${disc[0]}=${String(disc[1].const)}` : opt.type === "null" ? "null" : String(i);
    flatten(opt, `${path}<${label}>`, out);
  }
}

function shapeOf(s: z.ZodType, io: "input" | "output"): Shape {
  const out: Shape = {};
  flatten(z.toJSONSchema(s, { io, unrepresentable: "any", cycles: "ref" }) as Js, "", out);
  return out;
}

const isSchema = (v: unknown): v is z.ZodType => v instanceof z.ZodType;
const requestNames = Object.keys(C).filter((n) => /(Request|Input|Query)$/.test(n) || n === "ClientCrashReport").filter((n) => isSchema((C as Record<string, unknown>)[n])).sort();
const responseNames = [...RESPONSES, ...Object.keys(C).filter((n) => n.endsWith("Schema") && isSchema((C as Record<string, unknown>)[n]))].sort();

function current(): { requests: Record<string, Shape>; responses: Record<string, Shape> } {
  const get = (n: string) => (C as Record<string, unknown>)[n] as z.ZodType;
  return {
    requests: Object.fromEntries(requestNames.map((n) => [n, shapeOf(get(n), "input")])),
    responses: Object.fromEntries(responseNames.map((n) => [n, shapeOf(get(n), "output")])),
  };
}

const parentOf = (p: string) => p.replace(/(\.[^.<[{]+|\[\]|\{\}|<[^>]*>)$/, "");

/** Cambios que romperían a una app ya instalada. */
export function breakingChanges(base: ReturnType<typeof current>, now: ReturnType<typeof current>): string[] {
  const out: string[] = [];
  for (const [name, was] of Object.entries(base.requests)) {
    const is = now.requests[name];
    if (!is) continue; // Un esquema de petición retirado no rompe a nadie: la ruta responde 404 o lo ignora.
    for (const [p, v] of Object.entries(is)) {
      if (p.endsWith("#enum")) continue;
      const parent = parentOf(p);
      if (v === "required" && was[p] !== "required" && (parent === "" || parent in was)) out.push(`${name}${p}: la app ya instalada no lo envía y ahora es obligatorio`);
    }
    for (const [p, v] of Object.entries(was)) {
      if (!p.endsWith("#enum") || !(p in is)) continue;
      const gone = v.split("|").filter((x) => !is[p]!.split("|").includes(x));
      if (gone.length) out.push(`${name}${p}: la app ya instalada puede enviar ${gone.join(", ")}`);
    }
  }
  for (const [name, was] of Object.entries(base.responses)) {
    const is = now.responses[name];
    if (!is) { out.push(`${name}: la respuesta desapareció del contrato`); continue; }
    for (const [p, v] of Object.entries(was)) {
      if (p.endsWith("#enum")) {
        if (VALIDATED_BY_APP.includes(name) && p in is) {
          const added = is[p]!.split("|").filter((x) => !v.split("|").includes(x));
          if (added.length) out.push(`${name}${p}: la app ya instalada valida con zod y rechazaría ${added.join(", ")}`);
        }
        continue;
      }
      if (v === "required" && is[p] !== "required") out.push(`${name}${p}: la app ya instalada cuenta con este campo y ${p in is ? "ahora es opcional" : "ya no se envía"}`);
    }
  }
  return out;
}

describe("compatibilidad hacia atrás de los contratos (ADR 0343)", () => {
  it("ningún cambio rompe a una app ya instalada respecto de la línea base", () => {
    const now = current();
    if (process.env["CONTRACT_BASELINE"] === "update") writeFileSync(BASELINE, `${JSON.stringify(now, null, 1)}\n`);
    expect(existsSync(BASELINE), "falta la línea base de contratos").toBe(true);
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as ReturnType<typeof current>;
    expect(breakingChanges(base, now)).toEqual([]);
    // La línea base cubre cada respuesta conocida (una respuesta nueva se añade al regenerarla).
    expect(Object.keys(base.responses)).toEqual(expect.arrayContaining(RESPONSES));
  });

  it("detecta cada tipo de cambio incompatible", () => {
    const base = {
      requests: { R: shapeOf(z.object({ a: z.string(), b: z.enum(["X", "Y"]).optional(), o: z.object({ k: z.string() }).optional() }), "input") },
      responses: {
        S: shapeOf(z.object({ id: z.string(), n: z.number(), opt: z.string().optional() }), "output"),
        CategoryCatalog: shapeOf(z.object({ s: z.enum(["A", "B"]) }), "output"),
      },
    };
    const now = {
      requests: { R: shapeOf(z.object({ a: z.string(), b: z.enum(["X"]).optional(), c: z.string(), o: z.object({ k: z.string(), j: z.number() }).optional(), nuevo: z.object({ x: z.string() }).optional() }), "input") },
      responses: {
        S: shapeOf(z.object({ id: z.string().optional(), opt: z.string(), extra: z.string() }), "output"),
        CategoryCatalog: shapeOf(z.object({ s: z.enum(["A", "B", "C"]) }), "output"),
      },
    };
    expect(breakingChanges(base, now).sort()).toEqual([
      "CategoryCatalog.s#enum: la app ya instalada valida con zod y rechazaría C",
      "R.b#enum: la app ya instalada puede enviar Y",
      "R.c: la app ya instalada no lo envía y ahora es obligatorio",
      "R.o.j: la app ya instalada no lo envía y ahora es obligatorio",
      "S.id: la app ya instalada cuenta con este campo y ahora es opcional",
      "S.n: la app ya instalada cuenta con este campo y ya no se envía",
    ]);
    // Lo compatible no falla: campo de petición opcional nuevo (y obligatorios dentro de él), campo de respuesta nuevo.
    expect(breakingChanges(base, base)).toEqual([]);
  });

  it("un reporte con solo los campos de la primera versión sigue siendo válido", () => {
    const v1 = {
      clientReportId: "01928c1e-7b1a-7cc0-8a9e-2c4f5d6e7f80",
      categoryCode: "accident.traffic",
      pin: { lat: -12.05, lng: -77.04 },
      presence: { fix: { lat: -12.05, lng: -77.04, accuracyM: 8, fixTime: "2026-09-29T10:00:00Z" }, mockLocation: false, attestationToken: null, deviceClock: "2026-09-29T10:00:05Z" },
      capturedAt: "2026-09-29T10:00:00Z",
    };
    expect(C.SubmitReportRequest.safeParse(v1).success).toBe(true);
    expect(C.CreatePostRequest.safeParse({ text: "Hola" }).success).toBe(true);
    expect(C.CreateCommentRequest.safeParse({ text: "Hola" }).success).toBe(true);
  });
});
