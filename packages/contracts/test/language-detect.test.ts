import { describe, expect, it } from "vitest";
import { detectLanguage } from "../src/language-detect.js";

// Idioma del contenido sin modelo externo (ADR 0091). NO AI REQUIRED.
describe("detectLanguage", () => {
  const cases: [string, string][] = [
    ["Hay mucho humo en la calle y los bomberos ya están llegando", "es"],
    ["¿Alguien sabe si el puente sigue cerrado por la inundación?", "es"],
    ["There is a lot of smoke on the street and the firefighters are coming", "en"],
    ["The road is flooded near the bridge, avoid driving there", "en"],
    ["Tem muita fumaça na rua e os bombeiros já estão chegando", "pt"],
    ["A ponte está fechada por causa da inundação, não passem por aqui", "pt"],
    ["Il y a beaucoup de fumée dans la rue et les pompiers arrivent", "fr"],
    ["Le pont est fermé à cause de l'inondation, évitez le secteur", "fr"],
  ];
  for (const [text, lang] of cases) it(`${lang}: ${text.slice(0, 30)}`, () => expect(detectLanguage(text)).toBe(lang));

  it("texto corto, vacío o solo etiquetas y enlaces: sin idioma", () => {
    expect(detectLanguage("ok")).toBeNull();
    expect(detectLanguage("")).toBeNull();
    expect(detectLanguage(null)).toBeNull();
    expect(detectLanguage("#Lima #Sismo https://example.org @ana")).toBeNull();
  });
});
