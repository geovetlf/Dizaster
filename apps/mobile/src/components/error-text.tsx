import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import { useAnnounce } from "../lib/a11y/announce";
import { colors } from "../theme";

/**
 * Error en línea de una acción (ADR 0292): se lee en voz alta con lector de pantalla al aparecer o cambiar, y queda
 * marcado como alerta. El texto ya llega traducido (servidor por código, red por `networkErrorKey`).
 */
export function ErrorText({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  useAnnounce(children);
  return (
    <Text style={style ?? styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({ error: { color: colors.accentText } });
