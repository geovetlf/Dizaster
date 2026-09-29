/**
 * Detección determinista de datos personales en texto (ADR 0088, Blueprint §13.3: doxxing). NO AI REQUIRED.
 * Solo dice QUÉ tipos aparecen, nunca devuelve el dato. Lo usa el servidor para mandar la publicación a revisión
 * humana (nada se oculta solo) y la app para avisar antes de publicar.
 */
export type PersonalDataKind = "PHONE" | "EMAIL" | "ID_DOCUMENT" | "PAYMENT_CARD";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;
const ID_DOC = /(?:^|[^\p{L}])(?:dni|d\.n\.i\.?|c[eé]dula|pasaporte|passport|ruc|cpf|curp|rut|ssn|nif|nie|carn[eé]t? de extranjer[ií]a)[\s:#nº°.-]*[A-Z0-9][A-Z0-9.-]{5,14}/iu;
/** Tramos de dígitos con separadores típicos de teléfonos y tarjetas (sin comas: así no se unen coordenadas). */
const DIGIT_RUN = /\+?\(?\d[\d ().-]{5,}\d/g;
const DATE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/;
const YEAR_RANGE = /^\d{4}\s?-\s?\d{4}$/;
const DECIMAL = /\d{1,3}\.\d{4,}/g;

/** `publicNumbers`: números públicos conocidos (emergencias, líneas oficiales) en dígitos; no cuentan como teléfono. */
export function detectPersonalData(text: string, publicNumbers: ReadonlySet<string> = new Set()): PersonalDataKind[] {
  const found = new Set<PersonalDataKind>();
  if (EMAIL.test(text)) found.add("EMAIL");
  if (ID_DOC.test(text)) found.add("ID_DOCUMENT");
  for (const m of text.matchAll(DIGIT_RUN)) {
    const run = m[0].trim();
    if (DATE.test(run) || YEAR_RANGE.test(run) || (run.match(DECIMAL)?.length ?? 0) >= 2) continue;
    const digits = run.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) found.add("PAYMENT_CARD");
    else if (digits.length >= 8 && digits.length <= 15 && !publicNumbers.has(digits)) found.add("PHONE");
  }
  return [...found].sort();
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
