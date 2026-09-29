import type { FollowTarget, MyFollows } from "@dizaster/contracts";

export const EMPTY_FOLLOWS: MyFollows = { profiles: [], events: [], places: [] };

/** ¿Sigo este destino? (perfil por handle, evento por id, lugar por id del índice geográfico). */
export function isFollowing(my: MyFollows, target: FollowTarget, id: string): boolean {
  if (target === "profile") return my.profiles.some((p) => p.handle.toLowerCase() === id.toLowerCase());
  if (target === "event") return my.events.some((e) => e.id === id);
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
    return { ...my, events: on ? [{ id }, ...rest] : rest };
  }
  const rest = drop(my.places, "id") as MyFollows["places"];
  return { ...my, places: on ? [{ id, name, label: name }, ...rest] : rest };
}
