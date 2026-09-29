import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { BBox, CreateCommentRequest, DevicePlatform, MEDIA_UPLOAD_LIMITS, NegativeState, RegisterPushTokenRequest, type AppConfig } from "@dizaster/contracts";
import { LocalDiskStorage } from "../modules/media/index.js";
import type { Container } from "../container.js";
import { DomainError, forbidden } from "../platform/errors.js";
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

export async function buildApp(c: Container): Promise<FastifyInstance> {
  const app = Fastify({
    logger: c.env.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.authorization"] },
    bodyLimit: 256 * 1024,
  });

  app.decorateRequest("session", null);
  app.addHook("onRequest", async (req) => {
    const h = req.headers.authorization;
    if (h?.startsWith("Bearer ")) req.session = await c.identity.verifyToken(h.slice(7));
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) return reply.status(err.httpStatus).send({ error: err.code, message: err.message });
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
      killSwitches: { ai: c.cost.isKilled("ai"), translation: c.cost.isKilled("translation"), sms: c.cost.isKilled("sms") },
      limits: { maxVideoSeconds: 60, maxReportsPerHour: c.env.REPORTS_PER_HOUR_LIMIT },
      referenceVersions: { categories: c.ref.categories.version, emergencyNumbers: c.ref.emergency.version },
    };
    reply.header("cache-control", "public, max-age=300");
    return body;
  });

  // ───────────── Datos de referencia (cacheables en CDN) ─────────────
  app.get("/v1/reference/categories", async (_req, reply) => {
    reply.header("cache-control", "public, max-age=3600");
    return c.ref.categories;
  });

  app.get("/v1/reference/emergency-numbers", async (req, reply) => {
    const q = parse(z.object({ country: z.string().regex(/^[A-Z]{2}$/).optional() }), req.query);
    reply.header("cache-control", "public, max-age=3600");
    return {
      version: c.ref.emergency.version,
      numbers: q.country ? c.ref.emergencyNumbers(q.country) : c.ref.emergency.numbers,
    };
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

  // ───────────── Identidad (solo proveedor DEV en esta etapa) ─────────────
  if (c.env.DEV_AUTH_ENABLED) {
    app.post("/v1/auth/dev", async (req) => {
      const b = parse(
        z.object({ handle: z.string().min(2).max(40), platform: DevicePlatform.optional(), deviceId: z.uuid().optional() }),
        req.body,
      );
      const session = await c.identity.signIn("DEV", b.handle.toLowerCase(), b.handle);
      const deviceId = b.platform ? await c.identity.registerDevice(session.userId, b.platform, "dev", b.deviceId) : null;
      return { token: await c.identity.issueToken(session), userId: session.userId, profileId: session.profileId, deviceId };
    });
  }

  // ───────────── Dispositivos (push APNs / FCM) ─────────────
  app.put("/v1/devices/:id/push-token", async (req, reply) => {
    const session = requireSession(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await c.identity.setPushToken(session.userId, id, parse(RegisterPushTokenRequest, req.body));
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
        categories: z.string().optional().transform((s) => (s ? s.split(",").filter(Boolean) : undefined)),
      }),
      req.query,
    );
    reply.header("cache-control", "public, max-age=30");
    return c.events.queryMap(c.db, { bbox: q.bbox as [number, number, number, number], zoom: q.zoom, ...(q.categories ? { categories: q.categories } : {}) });
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
  app.get("/v1/events/:id/timeline", async (req) => ({ entries: await c.events.timeline(c.db, parse(IdParam, req.params).id) }));
  app.get("/v1/events/:id/verification", async (req) => c.verification.view(c.db, parse(IdParam, req.params).id));

  // Media pública del evento: solo variantes saneadas; en categorías sensibles, solo la aprobada por moderación.
  app.get("/v1/events/:id/media", async (req) => {
    const { id } = parse(IdParam, req.params);
    const event = await c.events.getEvent(c.db, id);
    const mediaIds = (await c.events.timeline(c.db, id))
      .filter((t) => t.type === "MEDIA_ADDED")
      .flatMap((t) => (Array.isArray(t.payload["mediaIds"]) ? (t.payload["mediaIds"] as string[]) : []));
    return { media: await c.media.publicViews(c.db, mediaIds, { requireApproval: event.sensitivity !== "NORMAL" }) };
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

  app.get("/v1/me", async (req, reply) => {
    const session = requireSession(req);
    reply.header("cache-control", "no-store");
    return c.feed.me(c.db, session.profileId);
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

  app.put("/v1/posts/:id/like", async (req) => {
    const session = requireSession(req);
    return c.social.setLike(c.db, parse(IdParam, req.params).id, session.profileId, true);
  });

  app.delete("/v1/posts/:id/like", async (req) => {
    const session = requireSession(req);
    return c.social.setLike(c.db, parse(IdParam, req.params).id, session.profileId, false);
  });

  app.get("/v1/posts/:id/comments", async (req) => ({ comments: await c.social.comments(c.db, parse(IdParam, req.params).id) }));

  app.post("/v1/posts/:id/comments", async (req, reply) => {
    const session = requireSession(req);
    const { text } = parse(CreateCommentRequest, req.body);
    return reply.status(201).send(await c.social.addComment(c.db, parse(IdParam, req.params).id, session.profileId, text));
  });

  // ───────────── Media (subida directa al almacenamiento) ─────────────
  app.post("/v1/media/uploads", async (req, reply) => {
    const session = requireSession(req);
    return reply.status(201).send(await c.media.createUpload(session.profileId, req.body));
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

  // ───────────── Moderación (rol moderator) ─────────────
  app.post("/v1/moderation/events/:id/negative-state", async (req) => {
    const session = requireSession(req);
    if (!session.roles.includes("moderator") && !session.roles.includes("admin")) throw forbidden("Solo moderación");
    const { id } = parse(IdParam, req.params);
    const b = parse(z.object({ to: NegativeState, reason: z.string().max(2000), evidenceRefs: z.array(z.uuid()).max(20).default([]) }), req.body);
    await c.verification.moderatorSetNegative({ eventId: id, moderatorUserId: session.userId, to: b.to, reason: b.reason, evidenceRefs: b.evidenceRefs });
    return c.verification.view(c.db, id);
  });

  return app;
}
