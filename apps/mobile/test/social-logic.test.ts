import type { ContextualLocation } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { EMPTY_FOLLOWS, followSections, isFollowing, withFollow } from "../src/lib/social/follow-state";
import { BUSINESS_CATEGORIES, SUPPORTED_LANGS } from "@dizaster/contracts";
import { BUSINESS_CATEGORY_LABEL, telUri, verificationIcon } from "../src/lib/social/business";
import { composeProblem } from "../src/lib/social/compose";
import { followablePlace } from "../src/lib/social/place";

describe("seguir (estado local)", () => {
  it("sigue y deja de seguir perfiles, eventos y lugares sin duplicar", () => {
    let my = withFollow(EMPTY_FOLLOWS, "profile", "Ana_1", true, "Ana");
    my = withFollow(my, "profile", "ana_1", true, "Ana");
    expect(my.profiles).toEqual([{ handle: "ana_1", displayName: "Ana" }]);
    expect(isFollowing(my, "profile", "ANA_1")).toBe(true);
    my = withFollow(my, "place", "PE:150122", true, "Miraflores");
    my = withFollow(my, "event", "e1", true);
    expect(isFollowing(my, "place", "PE:150122")).toBe(true);
    my = withFollow(my, "event", "e1", false);
    expect(isFollowing(my, "event", "e1")).toBe(false);
    expect(my.places).toHaveLength(1);
  });
});

describe("lugar que se puede seguir desde un evento", () => {
  const base: ContextualLocation = {
    country: { code: "PE", name: "Perú" },
    region: { id: "PE:15", code: "15", name: "Lima" },
    city: { id: "PE:1501", name: "Lima" },
    district: { id: "PE:150122", code: "150122", name: "Miraflores" },
    label: "Miraflores, Lima",
    granularity: "DISTRICT",
    timezone: "America/Lima",
  };
  it("el distrito si se publica; si no, la región; nunca una localidad puntual", () => {
    expect(followablePlace(base)).toEqual({ id: "PE:150122", name: "Miraflores" });
    expect(followablePlace({ ...base, district: null, city: { id: "NEP:1", name: "Tokyo" } })).toEqual({ id: "PE:15", name: "Lima" });
    expect(followablePlace(null)).toBeNull();
  });
});

describe("etiquetas y publicar", () => {
  it("sigue etiquetas por su forma canónica", () => {
    let my = withFollow(EMPTY_FOLLOWS, "tag", "Inundación", true, "Inundación");
    expect(my.tags).toEqual([{ tag: "inundacion", display: "Inundación" }]);
    expect(isFollowing(my, "tag", "INUNDACION")).toBe(true);
    my = withFollow(my, "tag", "inundacion", false);
    expect(my.tags).toEqual([]);
  });

  it("valida antes de enviar con las mismas reglas que el servidor", () => {
    expect(composeProblem("   ", [])).toBe("composeEmpty");
    expect(composeProblem("x".repeat(2001), [])).toBe("composeTooLong");
    expect(composeProblem("ok", [{ kind: "VIDEO_RECORDED" }, { kind: "VIDEO_RECORDED" }])).toBe("composeOneVideo");
    expect(composeProblem("ok #lima", [{ kind: "IMAGE" }, { kind: "VIDEO_RECORDED" }])).toBeNull();
  });
});

describe("negocios", () => {
  it("cada rubro tiene nombre en todos los idiomas y el sello solo aparece si está verificado", () => {
    for (const c of BUSINESS_CATEGORIES) for (const l of SUPPORTED_LANGS) expect(BUSINESS_CATEGORY_LABEL[c][l]?.trim(), `${c}/${l}`).toBeTruthy();
    expect(verificationIcon("UNVERIFIED")).toBeNull();
    expect(verificationIcon(undefined)).toBeNull();
    expect(verificationIcon("VERIFIED")).toBe("check-decagram");
    expect(verificationIcon("INSTITUTIONAL_OFFICIAL")).toBe("bank");
    expect(telUri("+51 (1) 555-0100")).toBe("tel:+5115550100");
  });

  it("sigue negocios por handle sin distinguir mayúsculas", () => {
    const my = withFollow(EMPTY_FOLLOWS, "business", "Farmacia_Sol", true, "Farmacia Sol");
    expect(my.businesses).toEqual([{ handle: "farmacia_sol", name: "Farmacia Sol" }]);
    expect(isFollowing(my, "business", "FARMACIA_SOL")).toBe(true);
    expect(withFollow(my, "business", "farmacia_sol", false).businesses).toEqual([]);
  });
});

describe("reacciones de contexto (ADR 0040)", () => {
  it("aplica y retira de forma optimista sin contar dos veces", async () => {
    const { applyReaction } = await import("../src/lib/social/reactions");
    const { reactionKindsFor } = await import("@dizaster/contracts");
    const s0 = { reactions: { USEFUL: 2 }, myReactions: [] as ("LIKE" | "SUPPORT" | "USEFUL" | "SEEN_TOO")[] };
    const s1 = applyReaction(s0, "USEFUL", true);
    expect(s1).toEqual({ reactions: { USEFUL: 3 }, myReactions: ["USEFUL"] });
    expect(applyReaction(s1, "USEFUL", true)).toBe(s1);
    expect(applyReaction(applyReaction(s0, "SUPPORT", true), "SUPPORT", false)).toEqual({ reactions: { USEFUL: 2 }, myReactions: [] });
    expect(reactionKindsFor({ event: null })).not.toContain("SEEN_TOO");
    expect(reactionKindsFor({ event: { id: "e" } })).toContain("SEEN_TOO");
  });
});

describe("hilos de comentarios (ADR 0045)", () => {
  it("pone cada respuesta bajo su comentario y huérfanas como raíz", async () => {
    const { threadComments } = await import("../src/lib/social/comments");
    const c = (id: string, parentId: string | null) => ({
      id, parentId, author: { handle: "a", displayName: "A" }, text: id, createdAt: "2026-01-01T00:00:00Z", mine: false, reactions: {}, myReactions: [],
    });
    const out = threadComments([c("1", null), c("2", null), c("1a", "1"), c("2a", "2"), c("1b", "1"), c("xa", "borrado")]);
    expect(out.map((x) => `${x.reply ? "  " : ""}${x.comment.id}`)).toEqual(["1", "  1a", "  1b", "2", "  2a", "xa"]);
  });
});

describe("followSections (ADR 0097)", () => {
  const names = { event: (e: { title: Record<string, string> | null; categoryCode: string }) => e.title?.["es"] ?? e.categoryCode, status: (s: string) => s.toLowerCase() };
  it("solo secciones con algo, en orden fijo, con etiquetas legibles", () => {
    const my = {
      ...EMPTY_FOLLOWS,
      tags: [{ tag: "lluvias", display: "Lluvias" }],
      events: [{ id: "e1", title: null, categoryCode: "fire.structure", status: "ACTIVE" }],
      places: [{ id: "PE:15", name: "Lima", label: "Lima" }, { id: "PE:150122", name: "Miraflores", label: "Miraflores, Lima" }],
    };
    const s = followSections(my, names);
    expect(s.map((x) => x.key)).toEqual(["events", "places", "tags"]);
    expect(s[0]!.rows[0]).toEqual({ target: "event", id: "e1", label: "fire.structure", sub: "active" });
    expect(s[1]!.rows.map((r) => r.sub)).toEqual([null, "Miraflores, Lima"]);
    expect(s[2]!.rows[0]!.label).toBe("#Lluvias");
    expect(followSections(EMPTY_FOLLOWS, names)).toEqual([]);
  });
});

describe("editar posts (ADR 0136)", () => {
  it("solo con plazo del servidor y sin vencer", async () => {
    const { canEditPost } = await import("../src/lib/social/edit");
    const now = new Date("2026-09-29T12:00:00Z");
    expect(canEditPost({ editableUntil: "2026-09-30T11:00:00Z" }, now)).toBe(true);
    expect(canEditPost({ editableUntil: "2026-09-29T11:00:00Z" }, now)).toBe(false);
    expect(canEditPost({ editableUntil: null }, now)).toBe(false);
    expect(canEditPost({}, now)).toBe(false);
  });
});
