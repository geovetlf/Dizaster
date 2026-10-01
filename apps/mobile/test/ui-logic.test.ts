import type { VerificationView } from "@dizaster/contracts";
import type { CategoryCatalog, MediaView } from "@dizaster/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoryStyle, homeChips, MORE_CODE } from "../src/lib/ui/categories";
import { areaRow, bboxParam, distanceLabel, formatKm, blurPreviewUri, duration, eventTitle, imageUri, initials, mediaLayout, parseBboxParam, postWhere, timeAgo } from "../src/lib/ui/format";
import { evidenceLine, explainLines, timelineLabel } from "../src/lib/verification/explain";

const catalog = JSON.parse(readFileSync(new URL("../../../data/categories/categories.json", import.meta.url), "utf8")) as CategoryCatalog;

describe("inicio según la referencia", () => {
  it("los accesos por categoría salen del catálogo y coinciden con el diseño", () => {
    const { chips, more } = homeChips(catalog);
    expect(chips.map((c) => c.label.es)).toEqual(["Todos", "Desastres", "Salud", "Delincuencia", "Accidentes", "Incendios", "Infraestructura", "Prevención", "Ayuda", "Más"]);
    expect(chips.at(-1)!.code).toBe(MORE_CODE);
    // Lo que no cabe en la rejilla sigue accesible desde "Más".
    expect(more.map((m) => m.code).sort()).toEqual(["emergency", "other"]);
  });

  it("un catálogo sin alguna raíz no muestra accesos rotos", () => {
    const smaller = { ...catalog, categories: catalog.categories.filter((c) => !c.code.startsWith("help")) };
    expect(homeChips(smaller).chips.some((c) => c.code === "help")).toBe(false);
  });

  it("el color del distintivo sigue a la categoría raíz", () => {
    expect(categoryStyle("fire.structure")).toEqual(categoryStyle("fire"));
    expect(categoryStyle("desconocida").icon).toBe("help-circle");
  });
});

describe("formato de publicaciones", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  it("tiempo relativo en español e inglés", () => {
    expect(timeAgo("2026-09-29T11:48:00Z", "es", now)).toBe("Hace 12 min");
    expect(timeAgo("2026-09-29T09:00:00Z", "en", now)).toBe("3 h ago");
    expect(timeAgo("2026-09-29T11:59:30Z", "es", now)).toBe("Ahora");
    expect(timeAgo("2026-09-29T11:48:00Z", "pt", now)).toBe("Há 12 min");
    expect(timeAgo("2026-09-27T11:00:00Z", "fr", now)).toBe("Il y a 2 j");
    expect(distanceLabel("<2km", "fr")).toBe("à moins de 2 km");
  });

  it("distancia por tramos, nunca exacta", () => {
    expect(distanceLabel("<2km", "es")).toBe("a menos de 2 km");
    expect(distanceLabel(">25km", "en")).toBe("over 25 km away");
    expect(distanceLabel(null, "es")).toBeNull();
  });

  it("duración de video e iniciales", () => {
    expect(duration(24_000)).toBe("0:24");
    expect(duration(61_400)).toBe("1:01");
    expect(initials("María Torres")).toBe("MT");
    expect(initials("dev_1a2b3c4d")).toBe("D");
  });

  it("mosaico de media: principal, hasta dos laterales y +N", () => {
    const m = (i: number) => ({ id: String(i) }) as MediaView;
    expect(mediaLayout([])).toEqual({ main: null, side: [], extra: 0 });
    expect(mediaLayout([m(1)])).toMatchObject({ side: [], extra: 0 });
    expect(mediaLayout([1, 2, 3, 4, 5].map(m))).toMatchObject({ main: { id: "1" }, side: [{ id: "2" }, { id: "3" }], extra: 2 });
  });

  it("miniatura para celdas pequeñas, versión de pantalla para lo grande", () => {
    expect(imageUri({ url: "d.jpg", thumbUrl: "t.jpg" }, "small")).toBe("t.jpg");
    expect(imageUri({ url: "d.jpg", thumbUrl: "t.jpg" }, "large")).toBe("d.jpg");
    expect(imageUri({ url: "v.mp4", thumbUrl: null }, "small")).toBe("v.mp4");
  });
});

describe("lugar contextual", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const createdAt = "2026-09-29T11:48:00Z";
  const place = { country: { code: "PE", name: "Perú" }, region: null, city: null, district: null, label: "Miraflores, Lima", granularity: "DISTRICT" as const, timezone: null };

  it("la tarjeta muestra el lugar del evento como en la referencia y, sin lugar, el tramo de distancia", () => {
    expect(postWhere({ createdAt, place, distanceBucket: "<2km" }, "es", now)).toBe("Hace 12 min • Miraflores, Lima");
    expect(postWhere({ createdAt, place: null, distanceBucket: "<2km" }, "es", now)).toBe("Hace 12 min • a menos de 2 km");
    expect(postWhere({ createdAt, place: null, distanceBucket: null }, "es", now)).toBe("Hace 12 min");
  });

  it("resultado de lugar: nombre y, debajo, nivel y jerarquía", () => {
    expect(areaRow({ name: "Miraflores", kind: "Distrito", label: "Miraflores, Lima, Perú" })).toEqual({ title: "Miraflores", subtitle: "Distrito · Lima, Perú" });
  });

  it("el bbox viaja como parámetro de ruta y se valida al volver", () => {
    const b: [number, number, number, number] = [-77.05, -12.14, -77.01, -12.1];
    expect(parseBboxParam(bboxParam(b))).toEqual(b);
    expect(parseBboxParam("1,2,3")).toBeNull();
    expect(parseBboxParam("0,10,1,5")).toBeNull();
    expect(parseBboxParam(undefined)).toBeNull();
  });
});

describe("título de evento", () => {
  it("usa el idioma de la app, luego cualquiera, luego la categoría", () => {
    expect(eventTitle({ title: { es: "Incendio", en: "Fire" }, categoryCode: "fire.structure" }, "en")).toBe("Fire");
    expect(eventTitle({ title: { es: "Incendio" }, categoryCode: "fire.structure" }, "fr")).toBe("Incendio");
    expect(eventTitle({ title: null, categoryCode: "fire.structure" }, "es")).toBe("fire.structure");
  });
});

describe("aviso de contenido sensible", () => {
  it("difumina la miniatura; un video sin póster no descarga nada", () => {
    expect(blurPreviewUri({ kind: "IMAGE", url: "d.jpg", thumbUrl: "t.jpg" })).toBe("t.jpg");
    expect(blurPreviewUri({ kind: "IMAGE", url: "d.jpg", thumbUrl: null })).toBe("d.jpg");
    expect(blurPreviewUri({ kind: "VIDEO_RECORDED", url: "v.mp4", thumbUrl: null })).toBeNull();
  });
});

describe("explicación de la verificación", () => {
  const tr = (k: string) => ({
    why_CITIZEN_CORROBORATION: "Confirmaciones: {independentWeight} de {threshold}.",
    why_EXTERNAL_SOURCES: "Externas: {count}.",
    why_CITIZEN_DENIALS: "Hay quien lo niega.",
    evidenceCounts: "{citizen} · {external} · {official}",
    tl_MERGED: "Unido",
  })[k] ?? k;

  it("una línea por regla, pesos con un decimal y sin la corroboración vacía", () => {
    const view: Pick<VerificationView, "explanation" | "evidenceSummary"> = {
      explanation: [
        { code: "CITIZEN_CORROBORATION", params: { independentWeight: 2.4999, threshold: 3 } },
        { code: "CITIZEN_DENIALS", params: { independentWeight: 1 } },
        { code: "EXTERNAL_SOURCES", params: { count: 2 } },
        { code: "REGLA_FUTURA", params: {} },
      ],
      evidenceSummary: { citizen: 3, external: 2, official: 0 },
    };
    expect(explainLines(view, tr as never)).toEqual(["Confirmaciones: 2.5 de 3.", "Hay quien lo niega.", "Externas: 2."]);
    expect(explainLines({ explanation: [{ code: "CITIZEN_CORROBORATION", params: { independentWeight: 0, threshold: 3 } }] }, tr as never)).toEqual([]);
    expect(evidenceLine(view, tr as never)).toBe("3 · 2 · 0");
  });

  it("la cronología usa etiquetas y deja pasar tipos nuevos", () => {
    expect(timelineLabel("MERGED", tr as never)).toBe("Unido");
    expect(timelineLabel("LIVE_STARTED", tr as never)).toBe("LIVE_STARTED");
  });
});

describe("unidades (ADR 0044)", () => {
  it("muestra km o millas según la preferencia", () => {
    expect(formatKm(5, "metric")).toBe("5 km");
    expect(formatKm(5, "imperial")).toBe("3.1 mi");
    expect(formatKm(25, "imperial")).toBe("16 mi");
    expect(distanceLabel("<2km", "en", "imperial")).toBe("within 1.2 mi");
    expect(distanceLabel(">25km", "es", "metric")).toBe("a más de 25 km");
    // Tramos en metros del contrato de eventos cercanos y decimales del idioma (ADR 0285).
    expect(distanceLabel("<100m", "es", "metric")).toBe("a menos de 100 m");
    expect(distanceLabel("<500m", "en", "imperial")).toBe("within 1,640 ft");
    expect(distanceLabel("<100m", "fr", "imperial")).toBe("à moins de 330 ft");
    expect(distanceLabel(">2km", "pt", "metric")).toBe("a mais de 2 km");
    expect(distanceLabel("<2km", "es", "imperial")).toBe("a menos de 1.2 mi"); // es-PE usa punto decimal
    expect(formatKm(5, "imperial", "fr")).toBe("3,1 mi");
    expect(distanceLabel("cerca", "es")).toBeNull();
  });
});
