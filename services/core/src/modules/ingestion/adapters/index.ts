import { capAdapter } from "./cap.js";
import { firmsAdapter } from "./firms.js";
import { gdacsAdapter } from "./gdacs.js";
import type { FeedAdapter } from "./types.js";
import { usgsAdapter } from "./usgs.js";

export type { FeedAdapter } from "./types.js";

/** Registro de adapters por formato. Añadir un formato = añadir una entrada aquí. */
export const FEED_ADAPTERS: ReadonlyMap<string, FeedAdapter> = new Map([usgsAdapter, gdacsAdapter, capAdapter, firmsAdapter].map((a) => [a.adapterType, a]));
