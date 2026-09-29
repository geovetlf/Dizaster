import type { FollowTarget, MyFollows } from "@dizaster/contracts";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { EMPTY_FOLLOWS, isFollowing, withFollow } from "./follow-state";

/** Estado de "seguir" compartido por la pantalla: carga lo que sigo y cambia con actualización optimista. */
export function useFollows() {
  const [my, setMy] = useState<MyFollows>(EMPTY_FOLLOWS);
  useEffect(() => { api.myFollows().then(setMy).catch(() => undefined); }, []);
  const toggle = useCallback(async (target: FollowTarget, id: string, name?: string) => {
    const on = !isFollowing(my, target, id);
    const before = my;
    setMy(withFollow(my, target, id, on, name));
    try {
      await api.follow(target, id, on);
    } catch {
      setMy(before);
    }
  }, [my]);
  return { my, toggle, following: (target: FollowTarget, id: string) => isFollowing(my, target, id) };
}
