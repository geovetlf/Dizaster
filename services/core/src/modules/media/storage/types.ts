import type { UploadInstruction } from "@dizaster/contracts";

/**
 * Almacenamiento de objetos detrás de una interfaz (cost-first, proveedor intercambiable).
 * Producción: cualquier servicio compatible con S3 (idealmente sin costo de egreso, D-18).
 * Desarrollo y pruebas: disco local.
 */
export interface StorageProvider {
  readonly id: string;
  /** URL de subida directa desde el dispositivo, firmada para un tamaño y tipo exactos. */
  presignPut(p: { key: string; mime: string; sizeBytes: number; ttlSeconds: number }): Promise<UploadInstruction>;
  stat(key: string): Promise<{ size: number; contentType: string | null } | null>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, data: Uint8Array, mime: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** URL de lectura de una variante pública (CDN o ruta firmada según el proveedor). */
  publicUrl(key: string): string;
}
