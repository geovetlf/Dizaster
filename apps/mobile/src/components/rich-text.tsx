import { segmentText } from "@dizaster/contracts";
import { router } from "expo-router";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "../theme";

/**
 * Texto de un post con #etiquetas y @menciones tocables. Solo se enlazan las menciones que el servidor confirmó
 * (perfiles que existen y no bloquearon al autor); el resto se ve como texto normal.
 */
export function RichText({ text, mentions, style }: { text: string; mentions: string[]; style?: StyleProp<TextStyle> }) {
  const valid = new Set(mentions.map((m) => m.toLowerCase()));
  return (
    <Text style={style}>
      {segmentText(text).map((s, i) => {
        if (s.kind === "tag") {
          return <Text key={i} accessibilityRole="link" style={{ color: colors.link }} onPress={() => router.push(`/tag/${encodeURIComponent(s.tag)}`)}>{s.text}</Text>;
        }
        if (s.kind === "mention" && valid.has(s.handle)) {
          return <Text key={i} accessibilityRole="link" style={{ color: colors.link }} onPress={() => router.push(`/u/${s.handle}`)}>{s.text}</Text>;
        }
        return s.text;
      })}
    </Text>
  );
}
