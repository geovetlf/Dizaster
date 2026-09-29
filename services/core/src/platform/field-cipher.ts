import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Cifrado por columna (Blueprint §13.1, ADR 0048): AES-256-GCM con la clave fuera de la base de datos (entorno o
 * gestor de secretos). Formato `kid.iv.tag.datos` en base64url; `aad` ata el texto cifrado a su fila (no se puede
 * copiar el valor de un reporte a otro). Varias claves para rotar: se cifra con la activa y se descifra con cualquiera.
 */
export class FieldCipher {
  private readonly keys: Map<string, Buffer>;

  constructor(private readonly activeId: string, keys: Record<string, Buffer>) {
    this.keys = new Map(Object.entries(keys));
    for (const [id, k] of this.keys) {
      if (k.length !== 32) throw new Error(`La clave ${id} debe tener 32 bytes`);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Id de clave inválido: ${id}`);
    }
    if (!this.keys.has(activeId)) throw new Error(`Falta la clave activa ${activeId}`);
  }

  encrypt(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.keys.get(this.activeId)!, iv);
    c.setAAD(Buffer.from(aad));
    const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return [this.activeId, iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
  }

  decrypt(sealed: string, aad: string): string {
    const [kid, iv, tag, data] = sealed.split(".");
    const key = kid ? this.keys.get(kid) : undefined;
    if (!key || !iv || !tag || data === undefined) throw new Error("Valor cifrado ilegible o clave desconocida");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
}

/**
 * `FIELD_KEYS="k2:<base64 32 bytes>,k1:<...>"`: la primera es la activa. Fuera de producción, sin claves, se deriva
 * una de desarrollo del secreto de sesión (nunca vale en producción: loadEnv lo impide).
 */
export function fieldCipherFromEnv(spec: string | undefined, devSecret: string): FieldCipher {
  if (!spec) return new FieldCipher("dev", { dev: createHash("sha256").update(`dizaster-field-key:${devSecret}`).digest() });
  const entries = spec.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(":");
    if (i < 1) throw new Error("FIELD_KEYS: formato kid:base64");
    return [p.slice(0, i), Buffer.from(p.slice(i + 1), "base64")] as const;
  });
  return new FieldCipher(entries[0]![0], Object.fromEntries(entries));
}
