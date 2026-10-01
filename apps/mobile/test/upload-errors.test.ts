import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGS, type MessageKey } from "../src/lib/i18n";
import { UPLOAD_ERROR_KEYS, uploadErrorText } from "../src/lib/media/upload-errors";

// La subida devuelve códigos, no textos en español (ADR 0285); se traducen al mostrarlos. NO AI REQUIRED.
describe("errores de subida de media", () => {
  it("el uploader solo devuelve códigos conocidos, nunca un texto", () => {
    const src = readFileSync(new URL("../src/lib/media/upload.ts", import.meta.url), "utf8");
    const literals = [...src.matchAll(/error:\s*(["'`])(.*?)\1/g)].map((m) => m[2]!);
    expect(literals.length).toBe(3);
    for (const l of literals) expect(Object.keys(UPLOAD_ERROR_KEYS)).toContain(l);
  });

  it("cada código tiene texto en los cuatro idiomas", () => {
    for (const key of Object.values(UPLOAD_ERROR_KEYS)) {
      for (const [lang, catalog] of Object.entries(CATALOGS)) expect(catalog[key], `${lang}.${key}`).toBeTruthy();
    }
  });

  it("traduce el código al idioma actual y deja igual un texto ya traducido", () => {
    const en = (k: MessageKey) => CATALOGS.en[k];
    expect(uploadErrorText("LOCAL_FILE_MISSING", en)).toBe(CATALOGS.en.errLocalFileMissing);
    expect(uploadErrorText("MEDIA_REJECTED", (k) => CATALOGS.fr[k])).toBe(CATALOGS.fr.errMediaRejected);
    expect(uploadErrorText("Too many requests", en)).toBe("Too many requests");
  });
});
