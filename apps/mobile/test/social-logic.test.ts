import type { ContextualLocation } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { EMPTY_FOLLOWS, isFollowing, withFollow } from "../src/lib/social/follow-state";
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
