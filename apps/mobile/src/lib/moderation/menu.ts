import type { FlagTargetType } from "@dizaster/contracts";
import { router } from "expo-router";
import { Alert } from "react-native";
import { api } from "../api";
import { t } from "../i18n";

/** Abre la pantalla de denuncia (modal, igual en iOS y Android). */
export const openFlag = (targetType: FlagTargetType, targetId: string) => router.push({ pathname: "/flag", params: { targetType, targetId } });

/** Bloquear con confirmación. Devuelve true si quedó bloqueado. */
export function confirmBlock(handle: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(`${t("block")} @${handle}`, t("blockConfirm"), [
      { text: t("cancel"), style: "cancel", onPress: () => resolve(false) },
      { text: t("block"), style: "destructive", onPress: () => { api.block(handle, true).then(() => resolve(true)).catch(() => resolve(false)); } },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * Menú de opciones de un post o comentario. Como mucho tres botones: es el máximo que Android muestra en un
 * diálogo del sistema, así el menú es idéntico en ambas plataformas.
 */
export function openContentMenu(target: { type: FlagTargetType; id: string; blockHandle: string | null }, onBlocked?: () => void): void {
  Alert.alert(t("options"), undefined, [
    { text: t("flag"), onPress: () => openFlag(target.type, target.id) },
    ...(target.blockHandle ? [{ text: `${t("block")} @${target.blockHandle}`, style: "destructive" as const, onPress: () => { void confirmBlock(target.blockHandle!).then((ok) => ok && onBlocked?.()); } }] : []),
    { text: t("cancel"), style: "cancel" },
  ], { cancelable: true });
}

/**
 * Menú de un post propio: borrarlo, o si es un reporte, retirarlo (su evidencia deja de contar para el evento,
 * ADR 0037). Siempre con confirmación.
 */
export function openOwnPostMenu(post: { id: string; isReport: boolean; onEdit?: (() => void) | null }, onDeleted: () => void): void {
  const label = post.isReport ? t("withdrawReport") : t("deletePost");
  const confirm = post.isReport ? t("withdrawReportConfirm") : t("deletePostConfirm");
  Alert.alert(t("options"), undefined, [
    // Editar solo dentro del plazo y nunca un reporte (ADR 0136).
    ...(post.onEdit ? [{ text: t("editPost"), onPress: post.onEdit }] : []),
    {
      text: label, style: "destructive" as const,
      onPress: () => {
        Alert.alert(label, confirm, [
          { text: t("cancel"), style: "cancel" },
          { text: label, style: "destructive", onPress: () => { api.deletePost(post.id).then(onDeleted).catch(() => undefined); } },
        ]);
      },
    },
    { text: t("cancel"), style: "cancel" },
  ], { cancelable: true });
}
