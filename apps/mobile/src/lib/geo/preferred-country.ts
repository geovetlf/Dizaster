import { File, Paths } from "expo-file-system";

/**
 * País preferido del perfil (ADR 0085), guardado también en el teléfono para que la pantalla de emergencia lo tenga
 * sin red. Es un código de dos letras, nada más.
 */
const file = () => new File(Paths.document, "preferred-country.txt");
let current: string | null | undefined;

export function preferredCountry(): string | null {
  if (current !== undefined) return current;
  try {
    const f = file();
    const v = f.exists ? f.textSync().trim() : "";
    current = /^[A-Z]{2}$/.test(v) ? v : null;
  } catch {
    current = null;
  }
  return current;
}

export function setPreferredCountry(code: string | null): void {
  if (code === preferredCountry()) return;
  current = code;
  try {
    const f = file();
    if (!code) { if (f.exists) f.delete(); return; }
    if (!f.exists) f.create();
    f.write(code);
  } catch {
    // Si no se puede guardar, vale para esta sesión.
  }
}
