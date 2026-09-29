import { segmentText } from "@dizaster/contracts";
import { router } from "expo-router";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { colors } from "../theme";

/**
 * Texto de un post con #etiquetas y @menciones tocables. Solo se enlazan las menciones que el servidor confirmó
 * (perfiles que existen y no bloquearon al autor, y negocios, que abren su página); el resto se ve como texto normal.
 */
export function RichText({ text, mentions, businessMentions = [], style }: { text: string; mentions: string[]; businessMentions?: string[]; style?: StyleProp<TextStyle> }) {
  const valid = new Set(mentions.map((m) => m.toLowerCase()));
  const businesses = new Set(businessMentions.map((m) => m.toLowerCase()));
  return (
    <Text style={style}>
      {segmentText(text).map((s, i) => {
        if (s.kind === "tag") {
          return <Text key={i} accessibilityRole="link" style={{ color: colors.link }} onPress={() => router.push(`/tag/${encodeURIComponent(s.tag)}`)}>{s.text}</Text>;
        }
        if (s.kind === "mention" && valid.has(s.handle)) {
          return <Text key={i} accessibilityRole="link" style={{ color: colors.link }} onPress={() => router.push(businesses.has(s.handle) ? `/b/${s.handle}` : `/u/${s.handle}`)}>{s.text}</Text>;
        }
        return s.text;
      })}
    </Text>
  );
}
