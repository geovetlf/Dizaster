import { z } from "zod";

/** Por qué le llega una alerta a esta persona. */
export const AlertMatch = z.enum(["FOLLOWED_EVENT", "FOLLOWED_PLACE", "CATEGORY", "PREVIOUSLY_ALERTED"]);
export type AlertMatch = z.infer<typeof AlertMatch>;

/**
 * Qué pasó. Nunca "hay una publicación nueva": solo EVENTs que cruzan un umbral o cambian de estado.
 * - NEW_EVENT: un evento pasa a ser alertable (corroborado o de fuente oficial/externa).
 * - STATE_CHANGED: confirmación oficial, corroboración externa, disputado o falso.
 * - SEVERITY_UP: sube de severidad hasta un nivel alto.
 * - RESOLVED: el evento terminó.
 */
export const AlertKind = z.enum(["NEW_EVENT", "STATE_CHANGED", "SEVERITY_UP", "RESOLVED"]);
export type AlertKind = z.infer<typeof AlertKind>;

const minutes = z.number().int().min(0).max(1439);

export const AlertPreferences = z.object({
  enabled: z.boolean(),
  followedEvents: z.boolean(),
  followedPlaces: z.boolean(),
  categories: z.boolean(),
  statusChanges: z.boolean(),
  /** Severidad mínima (1–5) para eventos nuevos en lugares o categorías seguidas. */
  minSeverity: z.number().int().min(1).max(5),
  /** Máximo de avisos push por hora; el resto queda solo en el historial. */
  maxPerHour: z.number().int().min(1).max(30),
  /** Horas de silencio en minutos desde medianoche (hora local de `timezone`). Una confirmación oficial grave las ignora. */
  quietHours: z.object({ start: minutes, end: minutes }).nullable(),
  timezone: z.string().min(1).max(64),
  lang: z.enum(["es", "en"]),
});
export type AlertPreferences = z.infer<typeof AlertPreferences>;
export const UpdateAlertPreferences = AlertPreferences.partial();

/** Suscripción a una categoría dentro de un área (lugar del índice geográfico o país entero). */
export const CategorySubscriptionInput = z.object({
  categoryCode: z.string().min(2).max(80),
  /** Id de área ("PE:150122") o código de país ("PE"). */
  areaId: z.string().min(2).max(40).regex(/^([A-Z]{2}|[A-Z0-9]+:[A-Za-z0-9-]+)$/),
  minSeverity: z.number().int().min(1).max(5).default(3),
});
export type CategorySubscriptionInput = z.infer<typeof CategorySubscriptionInput>;

export interface CategorySubscription {
  id: string;
  categoryCode: string;
  areaId: string;
  areaName: string;
  minSeverity: number;
}

export type NotificationStatus = "PENDING" | "SENT" | "GROUPED" | "SILENT_RATE_LIMIT" | "SILENT_QUIET_HOURS" | "NO_DEVICE" | "FAILED";

/** Entrada del historial. Solo datos públicos del EVENT: nunca autoría ni ubicación de quien reportó. */
export interface NotificationView {
  id: string;
  kind: AlertKind;
  match: AlertMatch;
  eventId: string;
  categoryCode: string;
  title: string;
  body: string;
  /** Deep link al EVENT: dizaster://event/<id>. */
  url: string;
  createdAt: string;
  readAt: string | null;
  /** Si hubo aviso push o quedó solo en el historial (límite por hora, horas de silencio…). */
  delivery: NotificationStatus;
}

export interface NotificationsResponse {
  notifications: NotificationView[];
  unread: number;
  nextCursor: string | null;
}

export const NotificationsQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
