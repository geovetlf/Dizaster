import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat as fsStat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { UploadInstruction } from "@dizaster/contracts";
import type { StorageProvider } from "./types.js";

/**
 * Almacenamiento en disco para desarrollo y pruebas. Imita el contrato de S3: URL de subida firmada con
 * caducidad, tamaño y tipo exactos. Las rutas HTTP que lo sirven solo existen fuera de producción.
 */
export class LocalDiskStorage implements StorageProvider {
  readonly id = "local";
  static readonly ROUTE = "/v1/dev-storage";

  constructor(
    private readonly root: string,
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async presignPut(p: { key: string; mime: string; sizeBytes: number; ttlSeconds: number }): Promise<UploadInstruction> {
    const exp = Math.floor(this.now().getTime() / 1000) + p.ttlSeconds;
    const sig = this.sign("PUT", p.key, exp, p.sizeBytes, p.mime);
    const q = new URLSearchParams({ exp: String(exp), size: String(p.sizeBytes), sig });
    return {
      method: "PUT",
      url: `${this.baseUrl}${LocalDiskStorage.ROUTE}/${encodeKey(p.key)}?${q}`,
      headers: { "content-type": p.mime },
    };
  }

  /** Comprueba una subida recibida por la ruta de desarrollo. */
  verifyPut(key: string, q: { exp?: string; size?: string; sig?: string }, contentType: string | undefined, bodyBytes: number): string | null {
    const exp = Number(q.exp);
    const size = Number(q.size);
    if (!q.sig || !Number.isFinite(exp) || !Number.isFinite(size)) return "Firma incompleta";
    if (exp < Math.floor(this.now().getTime() / 1000)) return "URL caducada";
    const expected = Buffer.from(this.sign("PUT", key, exp, size, contentType ?? ""));
    const given = Buffer.from(q.sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "Firma inválida";
    if (bodyBytes !== size) return "Tamaño distinto al firmado";
    return null;
  }

  async stat(key: string) {
    try {
      const s = await fsStat(this.path(key));
      const meta = JSON.parse(await readFile(this.path(key) + ".meta.json", "utf8")) as { contentType: string };
      return { size: s.size, contentType: meta.contentType };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }

  async put(key: string, data: Uint8Array, mime: string): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    await writeFile(file + ".meta.json", JSON.stringify({ contentType: mime }));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
    await rm(this.path(key) + ".meta.json", { force: true });
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}${LocalDiskStorage.ROUTE}/${encodeKey(key)}`;
  }

  private sign(method: string, key: string, exp: number, size: number, mime: string): string {
    return createHmac("sha256", this.secret).update(`${method}\n${key}\n${exp}\n${size}\n${mime}`).digest("base64url");
  }

  private path(key: string): string {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(normalize(this.root) + sep)) throw new Error("Clave fuera del almacenamiento");
    return p;
  }
}

export const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
