import type { ReactionKind, ReactionState } from "@dizaster/contracts";
import type { IconProps } from "../../components/icon";
import type { MessageKey } from "../i18n";

/** Reacciones de contexto que van en la fila bajo el post; "me gusta" sigue en la barra de acciones. */
export const CONTEXT_REACTIONS: { kind: Exclude<ReactionKind, "LIKE">; icon: [IconProps["name"], IconProps["name"]]; label: MessageKey }[] = [
  { kind: "SUPPORT", icon: ["hand-heart-outline", "hand-heart"], label: "reactSupport" },
  { kind: "USEFUL", icon: ["lightbulb-on-outline", "lightbulb-on"], label: "reactUseful" },
  { kind: "SEEN_TOO", icon: ["eye-outline", "eye-check"], label: "reactSeenToo" },
];

/** Cambio optimista: se ve al instante y se corrige con la respuesta del servidor. */
export function applyReaction(s: ReactionState, kind: ReactionKind, on: boolean): ReactionState {
  const had = s.myReactions.includes(kind);
  if (had === on) return s;
  const n = Math.max(0, (s.reactions[kind] ?? 0) + (on ? 1 : -1));
  const reactions = { ...s.reactions };
  if (n > 0) reactions[kind] = n;
  else delete reactions[kind];
  const myReactions = on ? [...s.myReactions, kind].sort() : s.myReactions.filter((k) => k !== kind);
  return { reactions, myReactions };
}
