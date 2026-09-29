import { createHash } from "node:crypto";
import { MAP_WINDOW_HOURS, MEDIA_KILL_SWITCHES, MapWindow, MfaCodeRequest, MfaVerifyRequest, can, isStaff, type MfaStatus, type Permission } from "@dizaster/contracts";
import { isValidTile, tileBounds } from "@dizaster/geo-kit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BBox, CreateCommentRequest, DevicePlatform, MEDIA_UPLOAD_LIMITS, MergeEventsRequest, NegativeState, ReactionKind, CommentReactionKind, ConfirmAgeRequest, RegisterPushTokenRequest, RegisterSigningKeyRequest, RevertMergeRequest,
  SplitEventRequest, SetEventStatusRequest, DismissDuplicateRequest, DATA_EXPORT_FORMAT, type AppConfig, type Attribution, type AttributionsResponse, type DataExport, type EmergencyNumbersResponse, type EventSearchResponse,
} from "@dizaster/contracts";
import { LocalDiskStorage } from "../modules/media/index.js";
import type { Container } from "../container.js";
import { withWarning } from "../modules/feed/index.js";
import { TIMEZONE_ATTRIBUTION } from "../modules/geo/index.js";
import { withTransaction } from "../platform/db.js";
import { DomainError, forbidden } from "../platform/errors.js";
import { latencyMetric } from "../platform/metrics.js";
import { FixedWindowLimiter } from "../platform/rate-limit.js";
import { buildOpenApi } from "./openapi.js";
import type { Session } from "../modules/identity/index.js";

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
  }
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return r.data;
}

function requireSession(req: FastifyRequest): Session {
  if (!req.session) throw new DomainError("UNAUTHENTICATED", "Se requiere sesión", 401);
  return req.session;
}


/** Escrituras permitidas a una cuenta suspendida: apelar, cerrar y renovar sesiones, borrar sus posts y borrar la cuenta. */
/** Tope del documento que una fuente puede empujar (ADR 0128). */
const PUSH_BODY_LIMIT = 2 * 1024 * 1024;
const SourcePushParams = z.object({ sourceKey: z.string().regex(/^[a-z0-9-]{1,64}$/) });
const WRITE_ALLOWED_WHEN_SUSPENDED = /^(POST \/v1\/me\/moderation\/[^/]+\/appeal|POST \/v1\/auth\/(refresh|logout)|DELETE \/v1\/me|DELETE \/v1\/posts\/[^/]+|DELETE \/v1\/me\/sessions\/[^/]+|POST \/v1\/me\/sessions\/revoke-others)$/;

/**
 * Contenido público e interacción: exigen haber declarado la edad mínima (D-13, ADR 0049). Ajustes, dispositivos,
 * alertas, bloqueos y denuncias no: son de seguridad o privados.
 */
const AGE_REQUIRED = /^(POST \/v1\/(posts|reports|businesses|media\/uploads)|POST \/v1\/posts\/[^/]+\/(comments|share)|PUT \/v1\/(posts|comments)\/[^/]+\/(like|reactions\/[^/]+)|PUT \/v1\/businesses\/[^/]+|PATCH \/v1\/me|PATCH \/v1\/posts\/[^/]+)$/;

/** Versión del contrato publicada en OpenAPI; subirla al cambiar la forma de una respuesta. */
/** Cabeceras de seguridad de la API (ADR 0114). NO AI REQUIRED. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-site",
  "permissions-policy": "geolocation=(), camera=(), microphone=()",
};

export const API_VERSION = "1.0.0";

export async function buildApp(c: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: c.env.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.authorization"] },
    bodyLimit: 256 * 1024,
    trustProxy: c.env.TRUST_PROXY,
  });

  // Límite general (ADR 0047): por cuenta con sesión, por IP sin ella. Las escrituras tienen un cupo menor.
  const allLimiter = new FixedWindowLimiter(c.env.RATE_LIMIT_PER_MINUTE);
  const writeLimiter = new FixedWindowLimiter(c.env.RATE_LIMIT_WRITES_PER_MINUTE);

  // Rutas registradas, para el contrato OpenAPI (ADR 0052). HEAD lo añade Fastify a cada GET.
  const routes: string[] = [];
  app.addHook("onRoute", (r) => {
    for (const m of [r.method].flat()) if (m !== "HEAD") routes.push(`${m} ${r.url}`);
  });

  app.decorateRequest("session", null);
  // Cabeceras de seguridad (§13.1, ADR 0114) en toda respuesta, errores incluidos. La API solo sirve JSON y teselas:
  // nada que ejecutar ni incrustar. HSTS solo tiene efecto detrás de TLS (el proxy de producción).
  app.addHook("onRequest", async (_req, reply) => {
    reply.headers(SECURITY_HEADERS);
  });
  app.addHook("onRequest", async (req) => {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) req.session = await c.identity.verifyToken(h.slice(7));
    if (req.url.startsWith("/v1/")) {
      const key = req.session ? `u:${req.session.userId}` : `ip:${req.ip}`;
      const write = req.method !== "GET" && req.method !== "HEAD";
      const wait = allLimiter.hit(key) ?? (write ? writeLimiter.hit(key) : null);
      if (wait !== null) {
        c.meter.add("http", "rate_limited", 1);
        throw Object.assign(new DomainError("RATE_LIMITED", "Demasiadas peticiones; espera un momento", 429), { retryAfter: wait });
      }
    }
    // Cuentas suspendidas: pueden leer, apelar, cerrar sesión y borrar su cuenta; no publicar ni interactuar.
    if (req.session && req.method !== "GET" && req.method !== "HEAD" && !WRITE_ALLOWED_WHEN_SUSPENDED.test(`${req.method} ${req.url.split("?")[0]}`)) {
      await c.identity.assertCanWrite(req.session.userId, { requireAge: AGE_REQUIRED.test(`${req.method} ${req.url.split("?")[0]}`) });
    }
  });

  // ETag en recursos cacheables (ADR 0084, §6.3): la app o la CDN revalidan con If-None-Match y reciben 304 sin
  // cuerpo si nada cambió. Solo GET 200 con cache-control public/private (nunca no-store). Hash del cuerpo: sin estado.
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.method !== "GET" || reply.statusCode !== 200) return payload;
    const cc = String(reply.getHeader("cache-control") ?? "");
    if (!/\b(public|private)\b/.test(cc) || /no-store/.test(cc)) return payload;
    if (typeof payload !== "string" && !Buffer.isBuffer(payload)) return payload;
    const etag = weakEtag(payload);
    reply.header("etag", etag);
    if (ifNoneMatch(req.headers["if-none-match"], etag)) {
      reply.code(304);
      reply.removeHeader("content-length");
      return "";
    }
    return payload;
  });

  // Medición por grupo de rutas (/v1/<grupo>/...): peticiones y bytes de respuesta, agregados en memoria.
  app.addHook("onResponse", async (req, reply) => {
    const group = routeGroup(req.routeOptions.url);
    c.meter.add("http", "requests", 1, group);
    const len = Number(reply.getHeader("content-length") ?? 0);
    if (len > 0) c.meter.add("http", "response_bytes", len, group);
    c.meter.add("http", latencyMetric(reply.elapsedTime), 1);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) {
      const retry = (err as { retryAfter?: number }).retryAfter;
      if (retry) reply.header("retry-after", String(retry));
      return reply.status(err.httpStatus).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: "BAD_REQUEST", message: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: "INTERNAL", message: "Error interno" });
  });

  app.get("/health", async () => {
    await c.db.query("SELECT 1");
    return { status: "ok" };
  });

  // ───────────── Configuración remota (proveedor de mapa intercambiable, kill switches) ─────────────
  app.get("/v1/config", async (_req, reply) => {
    const body: AppConfig = {
      apiVersion: "v1",
      map: {
        id: c.env.MAP_PROVIDER_ID,
        kind: "VECTOR_STYLE_URL",
        styleUrl: { light: c.env.MAP_STYLE_URL_LIGHT, dark: c.env.MAP_STYLE_URL_DARK },
        attribution: c.env.MAP_ATTRIBUTION,
        maxZoom: 18,
        offlineRegions: true,
      },
      killSwitches: {
        ai: await c.cost.isKilled("ai"), translation: await c.cost.isKilled("translation"), sms: await c.cost.isKilled("sms"),
        [MEDIA_KILL_SWITCHES.uploads]: await c.cost.isKilled(MEDIA_KILL_SWITCHES.uploads),
        [MEDIA_KILL_SWITCHES.video]: await c.cost.isKilled(MEDIA_KILL_SWITCHES.video),
      },
      limits: { maxVideoSeconds: 60, maxReportsPerHour: c.env.REPORTS_PER_HOUR_LIMIT },
      referenceVersions: { categories: c.ref.categories.version, emergencyNumbers: c.ref.emergency.version },
    };
    reply.header("cache-control", "public, max-age=300");
    return body;
  });

  let openapi: Record<string, unknown> | null = null;
  app.get("/v1/openapi.json", async (_req, reply) => {
    openapi ??= buildOpenApi(routes, API_VERSION);
    reply.header("cache-control", "public, max-age=3600");
    return openapi;
  });

  // ───────────── Datos de referencia (cacheables en CDN) ─────────────
  app.get("/v1/reference/categories", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=3600");
    return c.ref.categories;
  });

  app.get("/v1/reference/emergency-numbers", async (req, reply): Promise<EmergencyNumbersResponse> => {
    const q = parse(z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional(), since: z.string().max(64).optional() }), req.query);
    const version = c.ref.emergency.version;
    reply.header("cache-control", "public, max-age=3600");
    // La app pregunta con la versión que tiene; si coincide no se repite el dataset (ADR 0039).
    if (q.since === version) return { version, unchanged: true, numbers: [], routes: [] };
    return { version, unchanged: false, numbers: q.country ? c.ref.emergencyNumbers(q.country) : c.ref.emergency.numbers, routes: c.ref.emergency.routes };
  });

  app.get("/v1/geo/country", async (req) => {
    const q = parse(z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }), req.query);
    const country = c.geo.countryOf(q);
    return { country, config: country ? c.ref.country(country) ?? null : null };
  });

  // Búsqueda de lugares en el índice abierto propio (sin geocodificador comercial). No recibe la ubicación del usuario.
  app.get("/v1/geo/areas", async (req, reply) => {
    reply.header("cache-control", "public, max-age=86400");
    return { areas: await c.geo.searchAreas(c.db, req.query) };
  });

  // Atribución y licencia de cada dataset geográfico importado (se muestra en "Acerca de").
  app.get("/v1/geo/datasets", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=86400");
    return { datasets: await c.geo.datasets(c.db) };
  });

  // "Acerca de / licencias" (§11.3): mapa (ODbL), datasets geográficos importados, zonas horarias y fuentes activas.
  app.get("/v1/about/attributions", async (_req, reply): Promise<AttributionsResponse> => {
    const attributions: Attribution[] = [
      { id: c.env.MAP_PROVIDER_ID, kind: "MAP", name: c.env.MAP_PROVIDER_ID, attribution: c.env.MAP_ATTRIBUTION, license: "ODbL 1.0", url: "https://www.openstreetmap.org/copyright" },
      ...(await c.geo.datasets(c.db)).map((d): Attribution => ({ id: d.id, kind: "GEO", name: d.source, attribution: d.attribution, license: d.license, url: null })),
      { ...TIMEZONE_ATTRIBUTION, kind: "TIMEZONE" },
      ...c.ref.sources
        .filter((s) => s.status === "ACTIVE")
        .map((s): Attribution => ({ id: String(s.key), kind: "SOURCE", name: String(s.name), attribution: String(s.name), license: String(s.license ?? ""), url: typeof s.termsUrl === "string" ? s.termsUrl : null })),
    ];
    reply.header("cache-control", "public, max-age=86400");
    return { attributions };
  });

  // ───────────── Identidad (solo proveedor DEV en esta etapa) ─────────────
  if (c.env.DEV_AUTH_ENABLED) {
    app.post("/v1/auth/dev", async (req) => {
      const b = parse(
        z.object({
          handle: z.string().min(2).max(40), platform: DevicePlatform.optional(), deviceId: z.uuid().optional(),
          /** Resumen (hash) del identificador de instalación del sistema, calculado en el teléfono (ADR 0068). */
          hardwareId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional(),
        }),
        req.body,
      );
      const session = await c.identity.signIn("DEV", b.handle.toLowerCase(), b.handle);
      const deviceId = b.platform ? await c.identity.registerDevice(session.userId, b.platform, "dev", b.deviceId, b.hardwareId) : null;
      const pair = await c.identity.startSession(session, deviceId);
      return { ...pair, userId: session.userId, profileId: session.profileId, deviceId };
    });
  }

  // Sesión: token de acceso corto (15 min) + refresh rotatorio de un solo uso (ADR 0021).
  app.post("/v1/auth/refresh", async (req, reply) => {
    const b = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    reply.header("cache-control", "no-store");
    return c.identity.refresh(b.refreshToken);
  });

  // Sesiones abiertas (ADR 0029): ver y cerrar inicios de sesión en otros dispositivos.
  app.get("/v1/me/sessions", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { sessions: await c.identity.sessions(session.userId, session.sessionId ?? null) };
  });
  app.delete("/v1/me/sessions/:id", async (req, reply) => {
    const session = requireSession(req);
    const n = await c.identity.revokeSessions(session.userId, { id: parse(IdParam, req.params).id });
    if (n === 0) throw new DomainError("NOT_FOUND", "Sesión no encontrada", 404);
    return reply.status(204).send();
  });
  app.post("/v1/me/sessions/revoke-others", async (req) => {
    const session = requireSession(req);
    return { revoked: await c.identity.revokeSessions(session.userId, { allExcept: session.sessionId ?? null }) };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const b = parse(z.object({ refreshToken: z.string().min(20).max(200) }), req.body);
    await c.identity.logout(b.refreshToken);
    return reply.status(204).send();
  });

  // ───────────── Dispositivos (push APNs / FCM) ─────────────
  app.put("/v1/devices/:id/push-token", async (req, reply) => {
    const session = requireSession(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await c.identity.setPushToken(session.userId, id, parse(RegisterPushTokenRequest, req.body));
    return reply.status(204).send();
  });

  // Clave pública con la que el teléfono firma la evidencia de sus reportes (ADR 0129).
  app.put("/v1/devices/:id/signing-key", async (req, reply) => {
    const session = requireSession(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await c.identity.registerSigningKey(session.userId, id, parse(RegisterSigningKeyRequest, req.body));
    return reply.status(204).send();
  });

  app.delete("/v1/devices/:id/push-token", async (req, reply) => {
    const session = requireSession(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await c.identity.clearPushToken(session.userId, id);
    return reply.status(204).send();
  });

  // ───────────── Reportes ciudadanos ─────────────
  app.post("/v1/reports", async (req, reply) => {
    const session = requireSession(req);
    const result = await c.reports.submit(session, req.body);
    return reply.status(result.outcome === "REJECTED" ? 422 : 200).send(result);
  });

  // ───────────── Eventos (solo datos públicos generalizados) ─────────────
  app.get("/v1/events", async (req, reply) => {
    const q = parse(
      z.object({
        bbox: z.string().transform((s) => s.split(",").map(Number)).pipe(BBox),
        zoom: z.coerce.number().min(0).max(22),
        categories: z.string().optional().transform((s) => (s ? s.split(",").filter(Boolean).slice(0, 20) : undefined)),
        verified: z.enum(["0", "1"]).optional(),
        window: MapWindow.optional(),
      }),
      req.query,
    );
    reply.header("cache-control", "public, max-age=30");
    return c.events.queryMap(c.db, {
      bbox: q.bbox as [number, number, number, number], zoom: q.zoom, ...(q.categories ? { categories: q.categories } : {}), verifiedOnly: q.verified === "1",
      ...(q.window ? { windowHours: MAP_WINDOW_HOURS[q.window] } : {}),
    });
  });

  // Misma capa, por teselas z/x/y (ADR 0078): URLs iguales para la misma zona → la CDN las comparte entre usuarios.
  app.get("/v1/events/tiles/:z/:x/:y", async (req, reply) => {
    const tile = parse(z.object({ z: z.coerce.number().int(), x: z.coerce.number().int(), y: z.coerce.number().int() }), req.params);
    if (!isValidTile(tile)) throw new DomainError("VALIDATION", "Tesela inválida");
    const q = parse(
      z.object({
        categories: z.string().optional().transform((s) => (s ? [...new Set(s.split(",").filter(Boolean))].sort().slice(0, 20) : undefined)),
        verified: z.enum(["0", "1"]).optional(),
        window: MapWindow.optional(),
      }),
      req.query,
    );
    reply.header("cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=30");
    return c.events.queryMap(c.db, {
      bbox: tileBounds(tile), zoom: tile.z, ...(q.categories ? { categories: q.categories } : {}), verifiedOnly: q.verified === "1",
      ...(q.window ? { windowHours: MAP_WINDOW_HOURS[q.window] } : {}),
    });
  });

  // "¿Es este el mismo evento?" — requiere sesión: solo quien está reportando lo consulta.
  app.get("/v1/events/nearby", async (req, reply) => {
    requireSession(req);
    const q = parse(
      z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), category: z.string().max(64) }),
      req.query,
    );
    reply.header("cache-control", "private, no-store");
    return { events: await c.events.nearby(c.db, { point: { lat: q.lat, lng: q.lng }, categoryCode: q.category }) };
  });

  const IdParam = z.object({ id: z.uuid() });
  app.get("/v1/events/:id", async (req) => c.events.getEvent(c.db, parse(IdParam, req.params).id));
  // Timeline y verificación siguen la misma visibilidad que la ficha: un evento oculto o retrasado da 404 (ADR 0103).
  app.get("/v1/events/:id/timeline", async (req) => {
    const { id } = parse(IdParam, req.params);
    await c.events.getEvent(c.db, id);
    return c.events.timelinePage(c.db, id, req.query);
  });
  app.get("/v1/events/:id/posts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.eventPosts(c.db, parse(IdParam, req.params).id, req.query, req.session?.profileId ?? null);
  });
  // Fuentes externas y oficiales del evento, con licencia y enlace al original (ADR 0055).
  // Búsqueda de eventos (ADR 0065): pública como el mapa; solo datos públicos del EVENT.
  app.get("/v1/search/events", async (req): Promise<EventSearchResponse> => ({ events: await c.events.search(c.db, req.query) }));
  // Búsqueda de publicaciones por texto (ADR 0107): mismas reglas que el feed.
  app.get("/v1/search/posts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.searchPosts(c.db, req.query, req.session?.profileId ?? null);
  });

  app.get("/v1/events/:id/sources", async (req, reply) => {
    const refs = await c.events.sourceItemRefs(c.db, parse(IdParam, req.params).id);
    reply.header("cache-control", "public, max-age=60");
    return { sources: await c.ingestion.sourcesView(c.db, refs) };
  });
  app.get("/v1/events/:id/verification", async (req) => {
    const { id } = parse(IdParam, req.params);
    await c.events.getEvent(c.db, id);
    return c.verification.view(c.db, id);
  });

  // Media pública del evento: solo variantes saneadas; en categorías sensibles, solo la aprobada por moderación.
  app.get("/v1/events/:id/media", async (req) => {
    const { id } = parse(IdParam, req.params);
    const event = await c.events.getEvent(c.db, id);
    const mediaIds = (await c.events.timeline(c.db, id))
      .filter((t) => t.type === "MEDIA_ADDED")
      .flatMap((t) => (Array.isArray(t.payload["mediaIds"]) ? (t.payload["mediaIds"] as string[]) : []));
    return { media: withWarning(await c.media.publicViews(c.db, mediaIds, { requireApproval: event.sensitivity !== "NORMAL" }), event.sensitivity) };
  });

  // ───────────── Red social ─────────────
  app.get("/v1/feed", async (req, reply) => {
    // Personal (me gusta propios) y puede llevar la ubicación del lector: nunca se cachea en intermediarios.
    reply.header("cache-control", "no-store");
    return c.feed.feed(c.db, req.query, req.session?.profileId ?? null);
  });

  // ───────────── Perfiles y seguir ─────────────
  const HandleParam = z.object({ handle: z.string().min(2).max(40).regex(/^[A-Za-z0-9_]+$/) });
  const FollowParams = z.object({ target: z.string(), id: z.string().min(1).max(64) });

  app.get("/v1/profiles", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { profiles: await c.feed.searchProfiles(c.db, req.query, req.session?.profileId ?? null) };
  });

  app.get("/v1/profiles/:handle", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.profile(c.db, parse(HandleParam, req.params).handle, req.session?.profileId ?? null);
  });

  app.get("/v1/profiles/:handle/posts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.profilePosts(c.db, parse(HandleParam, req.params).handle, req.query, req.session?.profileId ?? null);
  });

  /** Roles de la sesión: la app muestra herramientas de moderación o administración solo a quien las tiene. */
  // Exportar mis datos (ADR 0038). Consultas acotadas; como mucho una por minuto y persona en cada instancia.
  const lastExport = new Map<string, number>();
  app.get("/v1/me/export", async (req, reply) => {
    const session = requireSession(req);
    const now = Date.now();
    if (now - (lastExport.get(session.userId) ?? 0) < 60_000) throw new DomainError("RATE_LIMITED", "Espera un minuto antes de volver a exportar", 429);
    lastExport.set(session.userId, now);
    const who = { userId: session.userId, profileId: session.profileId };
    const body: DataExport = {
      format: DATA_EXPORT_FORMAT,
      generatedAt: new Date(now).toISOString(),
      sections: {
        identity: await c.identity.exportData(c.db, session.userId),
        social: await c.social.exportData(c.db, who),
        reports: await c.reports.exportData(c.db, session.userId),
        alerts: await c.alerts.exportData(c.db, session.profileId),
        moderation: await c.moderation.exportData(c.db, who),
        media: await c.media.exportData(c.db, session.profileId),
      },
    };
    reply.header("cache-control", "no-store");
    reply.header("content-disposition", `attachment; filename="dizaster-export-${body.generatedAt.slice(0, 10)}.json"`);
    return body;
  });
  app.get("/v1/me/account", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { roles: session.roles, ageConfirmed: await c.identity.ageConfirmed(session.userId), minAge: c.ref.minAge() };
  });

  // Edad mínima (D-13, ADR 0049). Permitido aunque aún no se pueda escribir: es el paso que lo habilita.
  app.post("/v1/me/age", async (req) => {
    const session = requireSession(req);
    const body = parse(ConfirmAgeRequest, req.body);
    return c.identity.confirmAge(session.userId, body.birthYear, body.birthMonth, c.ref.minAge(body.country));
  });

  // Borrar la cuenta desde la app (App Store 5.1.1(v) y Google Play). Irreversible: se pide confirmación explícita.
  app.delete("/v1/me", async (req, reply) => {
    const session = requireSession(req);
    parse(z.object({ confirm: z.literal("DELETE") }), req.body);
    await c.identity.deleteAccount(session.userId, session.profileId);
    return reply.status(202).send({ status: "DELETED" });
  });

  app.get("/v1/me", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return c.feed.me(c.db, session.profileId);
  });

  app.patch("/v1/me", async (req) => {
    const session = requireSession(req);
    return c.feed.updateMe(c.db, session.profileId, req.body);
  });

  app.put("/v1/me/avatar", async (req) => {
    const session = requireSession(req);
    return withTransaction(c.db, (tx) => c.feed.setMyAvatar(tx, session.profileId, req.body));
  });

  // ───────────── Alertas: preferencias, suscripciones e historial (personales: nunca se cachean) ─────────────
  app.get("/v1/me/alert-preferences", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return c.alerts.preferences(c.db, session.profileId);
  });

  app.put("/v1/me/alert-preferences", async (req) => {
    const session = requireSession(req);
    return c.alerts.updatePreferences(c.db, session.profileId, req.body);
  });

  app.get("/v1/me/alert-subscriptions", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { subscriptions: await c.alerts.subscriptions(c.db, session.profileId) };
  });

  app.post("/v1/me/alert-subscriptions", async (req, reply) => {
    const session = requireSession(req);
    return reply.status(201).send(await c.alerts.addSubscription(c.db, session.profileId, req.body));
  });

  app.delete("/v1/me/alert-subscriptions/:id", async (req, reply) => {
    const session = requireSession(req);
    await c.alerts.removeSubscription(c.db, session.profileId, parse(IdParam, req.params).id);
    return reply.status(204).send();
  });

  // Zonas guardadas y ubicación aproximada (D-16). Personales: nunca se cachean.
  app.get("/v1/me/zones", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { zones: await c.alerts.zones(c.db, session.profileId) };
  });

  app.post("/v1/me/zones", async (req, reply) => {
    const session = requireSession(req);
    return reply.status(201).send(await c.alerts.saveZone(c.db, session.profileId, req.body));
  });

  app.put("/v1/me/zones/:id", async (req) => {
    const session = requireSession(req);
    return c.alerts.saveZone(c.db, session.profileId, req.body, parse(IdParam, req.params).id);
  });

  app.delete("/v1/me/zones/:id", async (req, reply) => {
    const session = requireSession(req);
    await c.alerts.deleteZone(c.db, session.profileId, parse(IdParam, req.params).id);
    return reply.status(204).send();
  });

  app.put("/v1/me/approximate-location", async (req) => {
    const session = requireSession(req);
    return c.alerts.setApproximateLocation(c.db, session.profileId, req.body);
  });

  app.delete("/v1/me/approximate-location", async (req, reply) => {
    const session = requireSession(req);
    await c.alerts.clearApproximateLocation(c.db, session.profileId);
    return reply.status(204).send();
  });

  app.get("/v1/me/notifications", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return c.alerts.notifications(c.db, session.profileId, req.query);
  });

  app.post("/v1/me/notifications/read", async (req) => {
    const session = requireSession(req);
    const b = parse(z.object({ ids: z.array(z.uuid()).max(200).optional() }).optional(), req.body);
    return c.alerts.markRead(c.db, session.profileId, b?.ids ?? null);
  });

  app.get("/v1/me/follows", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return c.feed.myFollows(c.db, session.profileId);
  });

  app.put("/v1/follows/:target/:id", async (req) => {
    const session = requireSession(req);
    const p = parse(FollowParams, req.params);
    return c.feed.setFollow(c.db, session.profileId, p.target, p.id, true);
  });

  app.delete("/v1/follows/:target/:id", async (req) => {
    const session = requireSession(req);
    const p = parse(FollowParams, req.params);
    return c.feed.setFollow(c.db, session.profileId, p.target, p.id, false);
  });

  // ───────────── Publicaciones, etiquetas y menciones (ADR 0027) ─────────────
  app.post("/v1/posts", async (req, reply) => {
    const session = requireSession(req);
    reply.status(201);
    return c.composer.create(session, req.body);
  });

  app.post("/v1/posts/:id/share", async (req, reply) => {
    const session = requireSession(req);
    reply.status(201);
    return c.composer.share(session, parse(IdParam, req.params).id, req.body ?? {});
  });

  // Mis reportes (ADR 0094): estado, EVENT y cuándo se borra la ubicación precisa.
  app.get("/v1/me/reports", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { reports: await c.reports.myReports(c.db, session.userId) };
  });

  app.delete("/v1/me/reports/:id", async (req, reply) => {
    const session = requireSession(req);
    await c.reports.withdraw(session, parse(IdParam, req.params).id);
    return reply.status(204).send();
  });

  app.patch("/v1/posts/:id", async (req) => {
    const session = requireSession(req);
    return c.composer.edit(session.profileId, parse(IdParam, req.params).id, req.body);
  });

  app.delete("/v1/posts/:id", async (req, reply) => {
    const session = requireSession(req);
    const { id } = parse(IdParam, req.params);
    // Un post de tipo REPORT se "borra" retirando el reporte (su evidencia deja de contar, ADR 0037).
    const reportId = await c.reports.reportIdForPost(c.db, id);
    if (reportId) await c.reports.withdraw(session, reportId);
    else await c.composer.delete(session.profileId, id);
    return reply.status(204).send();
  });

  // ───────────── Negocios (ADR 0028) ─────────────
  const viewer = (req: FastifyRequest) => (req.session ? { userId: req.session.userId, profileId: req.session.profileId } : null);
  app.post("/v1/businesses", async (req, reply) => {
    const session = requireSession(req);
    reply.status(201);
    return c.business.create(session, req.body);
  });
  app.get("/v1/businesses", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { businesses: await c.business.search(req.query, viewer(req)) };
  });
  app.get("/v1/me/businesses", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { businesses: await c.business.mine(session) };
  });
  app.get("/v1/businesses/:handle", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.business.view(c.db, parse(HandleParam, req.params).handle, viewer(req));
  });
  app.put("/v1/businesses/:handle", async (req) => {
    const session = requireSession(req);
    return c.business.update(session, parse(HandleParam, req.params).handle, req.body);
  });
  app.put("/v1/businesses/:handle/logo", async (req) => {
    const session = requireSession(req);
    const { handle } = parse(HandleParam, req.params);
    return withTransaction(c.db, (tx) => c.feed.setBusinessLogo(tx, session, handle, req.body));
  });
  app.delete("/v1/businesses/:handle", async (req, reply) => {
    const session = requireSession(req);
    await c.institutions.retire(c.db, [await c.business.delete(session, parse(HandleParam, req.params).handle)]);
    return reply.status(204).send();
  });
  app.get("/v1/businesses/:handle/posts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.businessPosts(c.db, parse(HandleParam, req.params).handle, req.query, req.session?.profileId ?? null);
  });
  app.put("/v1/admin/businesses/:handle/verification", async (req) => {
    await requireAdmin(req);
    const { handle } = parse(HandleParam, req.params);
    const view = await c.business.setVerification(handle, req.body);
    // Sin el sello institucional, sus declaraciones dejan de contar como oficiales (ADR 0095).
    if (view.verification !== "INSTITUTIONAL_OFFICIAL") {
      const info = await c.business.officialInfo(c.db, handle);
      if (info) await c.institutions.retire(c.db, [info.id]);
    }
    return view;
  });
  app.put("/v1/admin/businesses/:handle/official-scope", async (req) => {
    await requireAdmin(req);
    return c.institutions.setScope(parse(HandleParam, req.params).handle, req.body);
  });
  app.get("/v1/businesses/:handle/official-scope", async (req, reply) => {
    reply.header("cache-control", "no-store");
    const info = await c.business.officialInfo(c.db, parse(HandleParam, req.params).handle);
    if (!info || !info.visible) throw new DomainError("NOT_FOUND", "Negocio no encontrado", 404);
    return { scope: info.verification === "INSTITUTIONAL_OFFICIAL" ? await c.institutions.scope(c.db, info.id) : null };
  });
  app.post("/v1/businesses/:handle/official-statements", async (req) => {
    const session = requireSession(req);
    return c.institutions.statement(session.userId, parse(HandleParam, req.params).handle, req.body);
  });

  app.get("/v1/tags", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return { tags: await c.feed.searchTags(c.db, req.query, req.session?.profileId ?? null) };
  });

  app.get("/v1/tags/:tag", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.tag(c.db, (req.params as { tag: string }).tag, req.session?.profileId ?? null);
  });

  app.get("/v1/tags/:tag/posts", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.tagPosts(c.db, (req.params as { tag: string }).tag, req.query, req.session?.profileId ?? null);
  });

  app.put("/v1/posts/:id/like", async (req) => {
    const session = requireSession(req);
    return c.social.setLike(c.db, parse(IdParam, req.params).id, session.profileId, true);
  });

  app.delete("/v1/posts/:id/like", async (req) => {
    const session = requireSession(req);
    return c.social.setLike(c.db, parse(IdParam, req.params).id, session.profileId, false);
  });

  // Reacciones de contexto (ADR 0040).
  const ReactionParams = IdParam.extend({ kind: ReactionKind });
  app.put("/v1/posts/:id/reactions/:kind", async (req) => {
    const session = requireSession(req);
    const p = parse(ReactionParams, req.params);
    return c.social.setReaction(c.db, p.id, session.profileId, p.kind, true);
  });

  app.delete("/v1/posts/:id/reactions/:kind", async (req) => {
    const session = requireSession(req);
    const p = parse(ReactionParams, req.params);
    return c.social.setReaction(c.db, p.id, session.profileId, p.kind, false);
  });

  // Una publicación por enlace (ADR 0083). Personal (reacciones propias, bloqueos): no se cachea.
  app.get("/v1/posts/:id", async (req, reply) => {
    reply.header("cache-control", "no-store");
    return c.feed.post(c.db, parse(IdParam, req.params).id, req.session?.profileId ?? null);
  });
  app.get("/v1/posts/:id/comments", async (req) => c.social.comments(c.db, parse(IdParam, req.params).id, req.session?.profileId ?? null, req.query));

  app.post("/v1/posts/:id/comments", async (req, reply) => {
    const session = requireSession(req);
    const { text, parentId } = parse(CreateCommentRequest, req.body);
    return reply.status(201).send(await c.social.addComment(c.db, parse(IdParam, req.params).id, session.profileId, text, parentId, (await c.trust.socialLimits(c.db, session.userId)).commentsPerMinute));
  });

  // Comentarios: borrar el propio y reaccionar (ADR 0045).
  app.delete("/v1/comments/:id", async (req, reply) => {
    const session = requireSession(req);
    await c.social.deleteComment(c.db, parse(IdParam, req.params).id, session.profileId);
    return reply.status(204).send();
  });
  const CommentReactionParams = IdParam.extend({ kind: CommentReactionKind });
  app.put("/v1/comments/:id/reactions/:kind", async (req) => {
    const session = requireSession(req);
    const p = parse(CommentReactionParams, req.params);
    return c.social.setCommentReaction(c.db, p.id, session.profileId, p.kind, true);
  });
  app.delete("/v1/comments/:id/reactions/:kind", async (req) => {
    const session = requireSession(req);
    const p = parse(CommentReactionParams, req.params);
    return c.social.setCommentReaction(c.db, p.id, session.profileId, p.kind, false);
  });

  // ───────────── Media (subida directa al almacenamiento) ─────────────
  app.post("/v1/media/uploads", async (req, reply) => {
    const session = requireSession(req);
    // Kill switches remotos (ADR 0082, §12.2): se cortan subidas o solo video sin desplegar. Los reportes siguen.
    const kind = (req.body as { kind?: unknown } | null)?.kind;
    if (await c.cost.isKilled(MEDIA_KILL_SWITCHES.uploads)) throw new DomainError("FEATURE_DISABLED", "Las fotos y videos están pausados por ahora", 503);
    if (kind === "VIDEO_RECORDED" && (await c.cost.isKilled(MEDIA_KILL_SWITCHES.video))) {
      throw new DomainError("FEATURE_DISABLED", "Los videos están pausados por ahora; puedes adjuntar fotos", 503);
    }
    const dailyBytes = await c.trust.uploadBytesQuota(c.db, session.userId, c.env.MEDIA_DAILY_UPLOAD_MB);
    return reply.status(201).send(await c.media.createUpload(session.profileId, req.body, dailyBytes));
  });

  app.post("/v1/media/:id/complete", async (req) => {
    const session = requireSession(req);
    return c.media.completeUpload(session.profileId, parse(IdParam, req.params).id);
  });

  app.get("/v1/media/:id", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return c.media.ownerState(session.profileId, parse(IdParam, req.params).id);
  });

  // Almacenamiento local de desarrollo: imita la subida firmada de S3. No existe en producción (config lo impide).
  if (c.storage instanceof LocalDiskStorage) {
    const local = c.storage;
    await app.register(async (sub) => {
      sub.addContentTypeParser(
        [...new Set(Object.values(MEDIA_UPLOAD_LIMITS).flatMap((l) => [...l.mimes]))],
        { parseAs: "buffer", bodyLimit: Math.max(...Object.values(MEDIA_UPLOAD_LIMITS).map((l) => l.maxBytes)) },
        (_req, body, done) => done(null, body),
      );
      sub.put(`${LocalDiskStorage.ROUTE}/*`, async (req, reply) => {
        const key = decodeURIComponent((req.params as { "*": string })["*"]);
        const body = req.body as Buffer | undefined;
        const err = local.verifyPut(key, req.query as Record<string, string>, req.headers["content-type"], body?.length ?? 0);
        if (err || !body) return reply.status(403).send({ error: "FORBIDDEN", message: err ?? "Sin contenido" });
        await local.put(key, body, req.headers["content-type"]!);
        return reply.status(200).send();
      });
      // Solo las variantes públicas; los originales nunca se sirven.
      sub.get(`${LocalDiskStorage.ROUTE}/public/*`, async (req, reply) => {
        const key = `public/${decodeURIComponent((req.params as { "*": string })["*"])}`;
        const obj = await local.stat(key);
        if (!obj) return reply.status(404).send({ error: "NOT_FOUND" });
        return reply.header("content-type", obj.contentType ?? "application/octet-stream").send(Buffer.from(await local.get(key)));
      });
    });
  }

  // ───────────── Push firmado de fuentes (Blueprint §9.2, ADR 0128) ─────────────
  // Cuerpo crudo: la firma se calcula sobre los bytes exactos, así que no se interpreta antes de verificarla.
  await app.register(async (sub) => {
    sub.removeAllContentTypeParsers();
    sub.addContentTypeParser("*", { parseAs: "string", bodyLimit: PUSH_BODY_LIMIT }, (_req, body, done) => done(null, body));
    sub.post("/v1/ingest/:sourceKey/push", async (req, reply) => {
      const { sourceKey } = parse(SourcePushParams, req.params);
      const header = (name: string) => { const v = req.headers[name]; return Array.isArray(v) ? v[0] : v; };
      const r = await c.ingestionScheduler.receivePush(sourceKey, typeof req.body === "string" ? req.body : "", {
        timestamp: header("x-dizaster-timestamp"), signature: header("x-dizaster-signature"),
      });
      if (r.ok) return reply.status(202).send({ itemsSeen: r.summary.itemsSeen, itemsNew: r.summary.itemsNew, itemsUrgent: r.summary.itemsUrgent });
      const status = r.code === "NOT_FOUND" ? 404 : r.code === "UNPARSEABLE" ? 422 : 401;
      return reply.status(status).send({ error: r.code });
    });
  });

  // ───────────── MFA TOTP del personal (ADR 0090) ─────────────
  const requireStaffRole = (req: FastifyRequest) => {
    const session = requireSession(req);
    if (!isStaff(session.roles)) throw forbidden("Solo personal de Dizaster");
    return session;
  };
  // Permisos por rol (ADR 0101): una tabla compartida con la app; además, MFA verificada cuando es obligatoria.
  const requirePermission = async (req: FastifyRequest, permission: Permission) => {
    const session = requireSession(req);
    if (!can(session.roles, permission)) throw forbidden("Tu rol no permite esta acción");
    await c.mfa.assertStaff(session);
    return session;
  };
  app.get("/v1/me/mfa", async (req, reply): Promise<MfaStatus> => {
    const session = requireStaffRole(req);
    reply.header("cache-control", "no-store");
    return { ...(await c.mfa.status(c.db, session.userId)), required: c.mfa.required };
  });
  app.post("/v1/me/mfa/totp", async (req, reply) => {
    const session = requireStaffRole(req);
    reply.header("cache-control", "no-store");
    return c.mfa.enroll(session.userId, await c.social.handleById(c.db, session.profileId));
  });
  app.post("/v1/me/mfa/totp/confirm", async (req, reply) => {
    const session = requireStaffRole(req);
    reply.header("cache-control", "no-store");
    return c.mfa.confirm(session.userId, session.sessionId, parse(MfaCodeRequest, req.body).code);
  });
  app.post("/v1/me/mfa/verify", async (req, reply) => {
    const session = requireStaffRole(req);
    reply.header("cache-control", "no-store");
    const b = parse(MfaVerifyRequest, req.body);
    return c.mfa.verify(session.userId, session.sessionId, "code" in b ? { code: b.code } : { recoveryCode: b.recoveryCode });
  });
  app.post("/v1/me/mfa/totp/disable", async (req, reply) => {
    const session = requireStaffRole(req);
    await c.mfa.disable(session.userId, parse(MfaCodeRequest, req.body).code);
    return reply.status(204).send();
  });

  // ───────────── Costos (rol admin): tablero, presupuestos y kill switches remotos ─────────────
  // Personal (ADR 0090): además del rol, segundo factor verificado en esta sesión cuando MFA es obligatoria.
  const requireAdmin = (req: FastifyRequest) => requirePermission(req, "admin");
  app.get("/v1/admin/cost", async (req, reply) => {
    await requirePermission(req, "ops.view");
    // Lo medido en este proceso entra antes de leer: el tablero no va por detrás de sí mismo.
    await c.meter.flush(c.cost);
    reply.header("cache-control", "no-store");
    return c.cost.dashboard(req.query);
  });
  // Informe de transparencia agregado (ADR 0135): solo administración; pensado para publicarse.
  app.get("/v1/admin/transparency", async (req, reply) => {
    await requireAdmin(req);
    reply.header("cache-control", "no-store");
    return c.moderation.transparency(req.query, c.clock.now());
  });
  // Registro auditado de requerimientos de autoridades (ADR 0139): solo administración y SOLO registro; no hay ruta de
  // entrega o exportación de datos (decisión del propietario, hasta contar con asesoría legal).
  app.get("/v1/admin/authority-requests", async (req, reply) => {
    await requireAdmin(req);
    reply.header("cache-control", "no-store");
    return c.authorityRequests.list(req.query);
  });
  app.post("/v1/admin/authority-requests", async (req, reply) => {
    const { userId } = await requireAdmin(req);
    reply.code(201);
    return c.authorityRequests.create(req.body, userId);
  });
  app.get<{ Params: { id: string } }>("/v1/admin/authority-requests/:id", async (req, reply) => {
    await requireAdmin(req);
    reply.header("cache-control", "no-store");
    return c.authorityRequests.detail(req.params.id);
  });
  app.post<{ Params: { id: string } }>("/v1/admin/authority-requests/:id/status", async (req) => {
    const { userId } = await requireAdmin(req);
    return c.authorityRequests.changeStatus(req.params.id, req.body, userId);
  });
  app.post<{ Params: { id: string } }>("/v1/admin/authority-requests/:id/notes", async (req) => {
    const { userId } = await requireAdmin(req);
    return c.authorityRequests.addNote(req.params.id, req.body, userId);
  });
  app.get("/v1/admin/quality", async (req, reply) => {
    await requirePermission(req, "ops.view");
    await c.meter.flush(c.cost);
    reply.header("cache-control", "no-store");
    return c.quality.report(req.query);
  });
  app.put("/v1/admin/cost/budgets/:key", async (req) => {
    const session = await requireAdmin(req);
    return c.cost.setBudget((req.params as { key: string }).key, req.body, session.userId);
  });
  // Retraso de publicación de categorías HIGHLY_SENSITIVE (ADR 0109).
  app.get("/v1/admin/categories/:code/publish-delay", async (req) => {
    await requireAdmin(req);
    return c.events.publishDelayView(c.db, adminCategory((req.params as { code: string }).code));
  });
  app.put("/v1/admin/categories/:code/publish-delay", async (req) => {
    const session = await requireAdmin(req);
    return c.events.setPublishDelay(c.db, adminCategory((req.params as { code: string }).code), req.body, session.userId);
  });
  const adminCategory = (code: string) => {
    const cat = c.ref.category(code);
    if (!cat) throw new DomainError("NOT_FOUND", "Categoría no encontrada", 404);
    return cat;
  };

  app.put("/v1/admin/kill-switches/:feature", async (req) => {
    const session = await requirePermission(req, "ops.control");
    return c.cost.setKillSwitch((req.params as { feature: string }).feature, req.body, session.userId);
  });

  // ───────────── Denuncias y bloqueos (cualquier persona) ─────────────
  app.post("/v1/flags", async (req, reply) => {
    const session = requireSession(req);
    await c.moderation.flag(session, req.body);
    return reply.status(202).send({ received: true });
  });
  app.put("/v1/blocks/:handle", async (req) => {
    const session = requireSession(req);
    await c.social.setBlockByHandle(c.db, session, (req.params as { handle: string }).handle, true);
    return { blocked: true };
  });
  app.delete("/v1/blocks/:handle", async (req) => {
    const session = requireSession(req);
    await c.social.setBlockByHandle(c.db, session, (req.params as { handle: string }).handle, false);
    return { blocked: false };
  });
  app.get("/v1/me/blocks", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { handles: await c.social.blockedHandles(c.db, session.profileId) };
  });
  // Transparencia: qué se hizo con mi contenido o mi cuenta, por qué, y apelación.
  app.get("/v1/me/moderation", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return { notices: await c.moderation.myNotices(session.userId) };
  });
  app.post("/v1/me/moderation/:id/appeal", async (req, reply) => {
    const session = requireSession(req);
    return reply.status(201).send(await c.moderation.appeal(session.userId, parse(IdParam, req.params).id, req.body));
  });

  // ───────────── Moderación (rol moderator) ─────────────
  const requireModerator = (req: FastifyRequest) => requirePermission(req, "content.moderate");
  const requireVerifier = (req: FastifyRequest) => requirePermission(req, "event.verify");
  app.get("/v1/moderation/cases", async (req, reply) => {
    const session = await requireModerator(req);
    reply.header("cache-control", "no-store");
    return c.moderation.queue(req.query, session.userId);
  });
  app.get("/v1/moderation/cases/:id", async (req, reply) => {
    const session = await requireModerator(req);
    reply.header("cache-control", "no-store");
    return c.moderation.caseDetail(parse(IdParam, req.params).id, session.userId);
  });
  // Tomar y soltar un caso (ADR 0134): evita que dos personas revisen lo mismo.
  app.post("/v1/moderation/cases/:id/claim", async (req) => {
    const session = await requireModerator(req);
    return c.moderation.claim(parse(IdParam, req.params).id, session.userId);
  });
  app.delete("/v1/moderation/cases/:id/claim", async (req, reply) => {
    const session = await requireModerator(req);
    await c.moderation.release(parse(IdParam, req.params).id, session.userId);
    return reply.status(204).send();
  });
  // Evidencia de presencia de un reporte (ADR 0089): POST porque cada consulta es un acto auditado con motivo.
  app.post("/v1/moderation/posts/:id/presence", async (req, reply) => {
    const session = await requireModerator(req);
    reply.header("cache-control", "no-store");
    return c.reports.presenceForReview(parse(IdParam, req.params).id, session.userId, req.body);
  });
  app.get("/v1/admin/presence-access", async (req, reply) => {
    await requireAdmin(req);
    reply.header("cache-control", "no-store");
    const q = parse(z.object({ reportId: z.uuid().optional(), actorUserId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }), req.query);
    return { entries: await c.reports.presenceAccessLog(c.db, q) };
  });
  app.post("/v1/moderation/cases/:id/actions", async (req) => {
    const session = await requireModerator(req);
    return c.moderation.act(parse(IdParam, req.params).id, session.userId, req.body);
  });
  app.get("/v1/moderation/appeals", async (req, reply) => {
    await requireModerator(req);
    reply.header("cache-control", "no-store");
    const { status } = parse(z.object({ status: z.enum(["OPEN", "UPHELD", "REVERSED"]).default("OPEN") }), req.query);
    return { appeals: await c.moderation.appeals(status) };
  });
  app.post("/v1/moderation/appeals/:id/decision", async (req) => {
    const session = await requireModerator(req);
    return c.moderation.decideAppeal(parse(IdParam, req.params).id, session.userId, req.body);
  });
  // Fusión y división de eventos (ADR 0034). La auditoría vive en event.merge_log y event.split_log.
  app.get("/v1/moderation/events/:id", async (req, reply) => {
    await requireVerifier(req);
    reply.header("cache-control", "no-store");
    return c.events.moderatorDetail(c.db, parse(IdParam, req.params).id);
  });
  app.post("/v1/moderation/events/:id/merge", async (req) => {
    const session = await requireVerifier(req);
    const { id } = parse(IdParam, req.params);
    const b = parse(MergeEventsRequest, req.body);
    const mergeIds = await withTransaction(c.db, async (tx) => {
      const out: string[] = [];
      for (const sourceId of new Set(b.sourceEventIds)) out.push(await c.events.merge(tx, id, sourceId, `MODERATOR:${session.userId}`, b.reason));
      return out;
    });
    return { mergeIds, event: await c.events.moderatorDetail(c.db, id) };
  });
  // Cola de posibles duplicados (ADR 0076): se fusionan con la ruta de arriba o se descartan.
  app.get("/v1/moderation/duplicates", async (req, reply) => {
    await requireVerifier(req);
    reply.header("cache-control", "no-store");
    return { candidates: await c.events.duplicateQueue(c.db) };
  });
  app.post("/v1/moderation/duplicates/:id/dismiss", async (req, reply) => {
    const session = await requireVerifier(req);
    const { reason } = parse(DismissDuplicateRequest, req.body);
    await c.events.dismissDuplicate(c.db, parse(IdParam, req.params).id, session.userId, reason);
    return reply.status(204).send();
  });
  app.post("/v1/moderation/merges/:id/revert", async (req) => {
    const session = await requireVerifier(req);
    const { reason } = parse(RevertMergeRequest, req.body);
    return withTransaction(c.db, (tx) => c.events.revertMerge(tx, parse(IdParam, req.params).id, session.userId, reason));
  });
  app.post("/v1/moderation/events/:id/split", async (req, reply) => {
    const session = await requireVerifier(req);
    const { id } = parse(IdParam, req.params);
    const b = parse(SplitEventRequest, req.body);
    const eventId = await withTransaction(c.db, (tx) => c.events.split(tx, id, b.evidenceIds, session.userId, b.reason));
    return reply.status(201).send({ eventId });
  });
  app.post("/v1/moderation/events/:id/status", async (req) => {
    const session = await requireVerifier(req);
    const { id } = parse(IdParam, req.params);
    const b = parse(SetEventStatusRequest, req.body);
    await withTransaction(c.db, (tx) => c.events.setStatus(tx, id, b.to, session.userId, b.reason));
    return c.events.moderatorDetail(c.db, id);
  });
  app.post("/v1/moderation/events/:id/negative-state", async (req) => {
    const session = await requireVerifier(req);
    const { id } = parse(IdParam, req.params);
    const b = parse(z.object({ to: NegativeState, reason: z.string().max(2000), evidenceRefs: z.array(z.uuid()).max(20).default([]) }), req.body);
    await c.verification.moderatorSetNegative({ eventId: id, moderatorUserId: session.userId, to: b.to, reason: b.reason, evidenceRefs: b.evidenceRefs });
    return c.verification.view(c.db, id);
  });

  return app;
}

/** "/v1/events/:id" → "events". Sin ruta (404) → "unmatched"; fuera de /v1 → primer segmento. */
export function routeGroup(url: string | undefined): string {
  if (!url) return "unmatched";
  const parts = url.split("/").filter(Boolean);
  return (parts[0] === "v1" ? parts[1] : parts[0])?.replace(/^:.*/, "param") ?? "root";
}

/** ETag débil: el mismo JSON da la misma etiqueta en cualquier instancia (ADR 0084). */
export function weakEtag(body: string | Buffer): string {
  return `W/"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`;
}

/** ¿Alguna de las etiquetas de If-None-Match coincide? Comparación débil (RFC 9110 §13.1.2). */
export function ifNoneMatch(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const strip = (x: string) => x.trim().replace(/^W\//, "");
  return (Array.isArray(header) ? header.join(",") : header).split(",").some((t) => t.trim() === "*" || strip(t) === strip(etag));
}
