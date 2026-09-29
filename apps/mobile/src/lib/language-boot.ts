// Efecto al importar: aplica el idioma elegido antes de que se evalúe cualquier pantalla (ADR 0069).
import { applyLanguagePref, loadLanguagePref } from "./language-store";

applyLanguagePref(loadLanguagePref());
