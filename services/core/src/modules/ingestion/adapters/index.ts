import { capAdapter } from "./cap.js";
import { copernicusEmsAdapter } from "./copernicus-ems.js";
import { emscAdapter } from "./emsc.js";
import { firmsAdapter } from "./firms.js";
import { gdacsAdapter } from "./gdacs.js";
import { reliefwebAdapter } from "./reliefweb.js";
import { rssNewsAdapter } from "./rss-news.js";
import type { FeedAdapter } from "./types.js";
import { usgsAdapter } from "./usgs.js";
import { whoDonAdapter } from "./who-don.js";

export type { FeedAdapter } from "./types.js";

/** Registro de adapters por formato. Añadir un formato = añadir una entrada aquí. */
export const FEED_ADAPTERS: ReadonlyMap<string, FeedAdapter> = new Map([usgsAdapter, gdacsAdapter, capAdapter, firmsAdapter, emscAdapter, reliefwebAdapter, whoDonAdapter, rssNewsAdapter, copernicusEmsAdapter].map((a) => [a.adapterType, a]));
