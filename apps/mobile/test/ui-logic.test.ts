import type { CategoryCatalog, MediaView } from "@dizaster/contracts";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { categoryStyle, homeChips, MORE_CODE } from "../src/lib/ui/categories";
import { distanceLabel, duration, initials, mediaLayout, timeAgo } from "../src/lib/ui/format";

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
});
