import { normalizeTag, type FollowTarget, type MyFollows } from "@dizaster/contracts";

export const EMPTY_FOLLOWS: MyFollows = { profiles: [], events: [], places: [], tags: [], businesses: [] };

/** ¿Sigo este destino? (perfil por handle, evento por id, lugar por id del índice geográfico). */
export function isFollowing(my: MyFollows, target: FollowTarget, id: string): boolean {
  if (target === "profile") return my.profiles.some((p) => p.handle.toLowerCase() === id.toLowerCase());
  if (target === "event") return my.events.some((e) => e.id === id);
  if (target === "tag") return my.tags.some((x) => x.tag === normalizeTag(id));
  if (target === "business") return my.businesses.some((b) => b.handle.toLowerCase() === id.toLowerCase());
  return my.places.some((p) => p.id === id);
}

/** Aplica un cambio local (optimista) sobre lo que sigo. */
export function withFollow(my: MyFollows, target: FollowTarget, id: string, on: boolean, name = id): MyFollows {
  const drop = (arr: { id?: string; handle?: string }[], key: "id" | "handle") => arr.filter((x) => (x[key] ?? "").toLowerCase() !== id.toLowerCase());
  if (target === "profile") {
    const rest = drop(my.profiles, "handle") as MyFollows["profiles"];
    return { ...my, profiles: on ? [{ handle: id, displayName: name }, ...rest] : rest };
  }
  if (target === "event") {
    const rest = drop(my.events, "id") as MyFollows["events"];
    return { ...my, events: on ? [{ id, title: null, categoryCode: "", status: "ACTIVE" }, ...rest] : rest };
  }
  if (target === "business") {
    const rest = my.businesses.filter((b) => b.handle.toLowerCase() !== id.toLowerCase());
    return { ...my, businesses: on ? [{ handle: id.toLowerCase(), name }, ...rest] : rest };
  }
  if (target === "tag") {
    const tag = normalizeTag(id);
    const rest = my.tags.filter((x) => x.tag !== tag);
    return { ...my, tags: on ? [{ tag, display: name }, ...rest] : rest };
  }
  const rest = drop(my.places, "id") as MyFollows["places"];
  return { ...my, places: on ? [{ id, name, label: name }, ...rest] : rest };
}

export interface FollowRow { target: FollowTarget; id: string; label: string; sub: string | null }

/**
 * "Lo que sigo" (ADR 0097): secciones no vacías, en orden fijo. El título del evento sale de su idioma o, si no
 * tiene, del nombre de su categoría. NO AI REQUIRED.
 */
export function followSections(
  my: MyFollows,
  names: { event: (e: MyFollows["events"][number]) => string; status: (s: string) => string },
): { key: "events" | "places" | "tags" | "profiles" | "businesses"; rows: FollowRow[] }[] {
  const all = [
    { key: "events" as const, rows: my.events.map((e) => ({ target: "event" as const, id: e.id, label: names.event(e), sub: names.status(e.status) })) },
    { key: "places" as const, rows: my.places.map((p) => ({ target: "place" as const, id: p.id, label: p.name, sub: p.label === p.name ? null : p.label })) },
    { key: "tags" as const, rows: my.tags.map((x) => ({ target: "tag" as const, id: x.tag, label: `#${x.display}`, sub: null })) },
    { key: "profiles" as const, rows: my.profiles.map((p) => ({ target: "profile" as const, id: p.handle, label: p.displayName, sub: `@${p.handle}` })) },
    { key: "businesses" as const, rows: my.businesses.map((b) => ({ target: "business" as const, id: b.handle, label: b.name, sub: `@${b.handle}` })) },
  ];
  return all.filter((s) => s.rows.length > 0);
}
