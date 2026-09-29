import type { ContextualLocation } from "@dizaster/contracts";
import { describe, expect, it } from "vitest";
import { EMPTY_FOLLOWS, isFollowing, withFollow } from "../src/lib/social/follow-state";
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
