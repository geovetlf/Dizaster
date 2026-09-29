import type { Attribution, AttributionKind } from "@dizaster/contracts";

/** Software libre que la app lleva dentro (los avisos completos van en los paquetes de la tienda). */
export const LIBRARIES: { name: string; license: string; url: string }[] = [
  { name: "MapLibre Native", license: "BSD-2-Clause", url: "https://github.com/maplibre/maplibre-native" },
  { name: "MapLibre React Native", license: "MIT", url: "https://github.com/maplibre/maplibre-react-native" },
  { name: "React Native", license: "MIT", url: "https://github.com/facebook/react-native" },
  { name: "Expo", license: "MIT", url: "https://github.com/expo/expo" },
  { name: "H3", license: "Apache-2.0", url: "https://github.com/uber/h3-js" },
  { name: "Zod", license: "MIT", url: "https://github.com/colinhacks/zod" },
  { name: "noble-curves / noble-hashes", license: "MIT", url: "https://github.com/paulmillr/noble-curves" },
  { name: "Material Design Icons", license: "Apache-2.0", url: "https://github.com/Templarian/MaterialDesign" },
];

const ORDER: AttributionKind[] = ["MAP", "GEO", "TIMEZONE", "SOURCE"];

/** Agrupa las atribuciones del servidor por tipo, en orden fijo y sin grupos vacíos. Colapsa duplicados por texto. */
export function groupAttributions(list: Attribution[]): { kind: AttributionKind; items: Attribution[] }[] {
  return ORDER.map((kind) => {
    const seen = new Set<string>();
    const items = list.filter((a) => a.kind === kind && !seen.has(`${a.attribution}|${a.license}`) && seen.add(`${a.attribution}|${a.license}`));
    return { kind, items };
  }).filter((g) => g.items.length > 0);
}
