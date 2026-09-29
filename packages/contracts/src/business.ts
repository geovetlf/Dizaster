import { z } from "zod";

/**
 * Perfiles de negocio (Blueprint §5.4, §7 BusinessProfile, D-04). V1: sin verificación de pago; la verifica
 * administración a mano. Un negocio publica posts pero nunca crea REPORTs ciudadanos.
 */
export const BusinessVerification = z.enum(["UNVERIFIED", "VERIFIED", "INSTITUTIONAL_OFFICIAL"]);
export type BusinessVerification = z.infer<typeof BusinessVerification>;

/** Rubros genéricos (no dependen del país). Las etiquetas por idioma viven en la app. */
export const BUSINESS_CATEGORIES = [
  "food", "grocery", "pharmacy", "health", "hardware", "fuel", "transport", "lodging", "services", "media", "ngo", "other",
] as const;
export const BusinessCategory = z.enum(BUSINESS_CATEGORIES);
export type BusinessCategory = z.infer<typeof BusinessCategory>;

/** Máximo de negocios por persona en V1 (evita granjas de perfiles). */
export const MAX_BUSINESSES_PER_USER = 3;

export const BusinessHandle = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,30}$/, "3 a 30 letras minúsculas, números o _");

const optionalText = (max: number) => z.string().trim().max(max).transform((s) => (s === "" ? null : s)).nullable().optional();

export const UpdateBusinessRequest = z.object({
  name: z.string().trim().min(2).max(80),
  category: BusinessCategory,
  country: z.string().regex(/^[A-Z]{2}$/).nullable().optional(),
  description: optionalText(500),
  /** Dirección que el negocio quiere publicar (opcional). Nunca se deriva de la ubicación de nadie. */
  addressPublic: optionalText(200),
  contactPhone: z.string().trim().regex(/^\+?[0-9 ()-]{5,30}$/).nullable().optional(),
  contactUrl: z.url({ protocol: /^https$/ }).max(300).nullable().optional(),
});
export type UpdateBusinessRequest = z.infer<typeof UpdateBusinessRequest>;

export const CreateBusinessRequest = UpdateBusinessRequest.extend({ handle: BusinessHandle });
export type CreateBusinessRequest = z.infer<typeof CreateBusinessRequest>;

export const SetBusinessVerificationRequest = z.object({ verification: BusinessVerification });

export interface BusinessView {
  handle: string;
  name: string;
  category: BusinessCategory;
  country: string | null;
  description: string | null;
  addressPublic: string | null;
  contactPhone: string | null;
  contactUrl: string | null;
  verification: BusinessVerification;
  followerCount: number;
  postCount: number;
  followedByMe: boolean;
  /** Quien mira lo administra (puede editar y publicar como el negocio). */
  isMine: boolean;
  createdAt: string;
}

export const BusinessSearchQuery = z.object({
  q: z.string().trim().min(2).max(40),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
