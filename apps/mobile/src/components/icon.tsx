import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps } from "react";

/** Iconos vectoriales (misma fuente en Android e iOS, sin imágenes por plataforma). */
export type IconProps = ComponentProps<typeof MaterialCommunityIcons>;
export const Icon = (p: IconProps) => <MaterialCommunityIcons {...p} />;
