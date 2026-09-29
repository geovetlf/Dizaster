import { Pressable, StyleSheet, Text, View } from "react-native";
import { lang } from "../../lib/i18n";
import type { CategoryChip } from "../../lib/ui/categories";
import { colors, radius, space } from "../../theme";
import { Icon } from "../icon";

/** Rejilla de accesos por categoría (5 por fila, como en la referencia). */
export function CategoryGrid({ chips, selected, onSelect }: { chips: CategoryChip[]; selected: string | null; onSelect: (c: CategoryChip) => void }) {
  return (
    <View style={styles.grid}>
      {chips.map((c) => {
        const active = c.code === selected;
        return (
          <Pressable
            key={c.code ?? "all"}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.active]}
            onPress={() => onSelect(c)}
          >
            <Icon name={c.icon} size={26} color={active ? colors.white : c.color} />
            <Text style={styles.label} numberOfLines={1} adjustsFontSizeToFit>{c.label[lang]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.lg },
  chip: { width: "18.4%", aspectRatio: 1.15, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: 2 },
  active: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.text, fontSize: 12 },
});
