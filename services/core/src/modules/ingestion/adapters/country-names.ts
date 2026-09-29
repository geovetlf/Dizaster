/**
 * Nombre de país (en inglés, español, francés o portugués) → ISO 3166-1 alfa-2, con los nombres que ya trae el
 * motor de Intl: sin tabla propia ni red. NO AI REQUIRED.
 */
let index: Map<string, string> | null = null;
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/^the\s+/, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

/** Nombres frecuentes en noticias que Intl escribe distinto. */
const ALIASES: Record<string, string> = {
  "democratic republic of the congo": "CD", "drc": "CD", "united states of america": "US", "usa": "US", "uk": "GB",
  "viet nam": "VN", "republic of korea": "KR", "turkiye": "TR", "cote d ivoire": "CI", "lao people s democratic republic": "LA",
  "syrian arab republic": "SY", "iran islamic republic of": "IR", "bolivia plurinational state of": "BO", "venezuela bolivarian republic of": "VE",
  "united republic of tanzania": "TZ", "russian federation": "RU", "republic of moldova": "MD",
};

function build(): Map<string, string> {
  const m = new Map<string, string>(Object.entries(ALIASES));
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const lang of ["en", "es", "fr", "pt"]) {
    let dn: Intl.DisplayNames;
    try { dn = new Intl.DisplayNames([lang], { type: "region", fallback: "none" }); } catch { continue; }
    for (const a of A) for (const b of A) {
      const code = a + b;
      const name = dn.of(code);
      if (name) { const k = fold(name); if (!m.has(k)) m.set(k, code); }
    }
  }
  return m;
}

export function countryCodeForName(name: string): string | null {
  const k = fold(name);
  if (!k) return null;
  index ??= build();
  return index.get(k) ?? null;
}
