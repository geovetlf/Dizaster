import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { BBox, NegativeState, type AppConfig } from "@dizaster/contracts";
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

  // ───────────── Identidad (solo proveedor DEV en esta etapa) ─────────────
  if (c.env.DEV_AUTH_ENABLED) {
    app.post("/v1/auth/dev", async (req) => {
      const b = parse(z.object({ handle: z.string().min(2).max(40), platform: z.enum(["IOS", "ANDROID"]).optional() }), req.body);
      const session = await c.identity.signIn("DEV", b.handle.toLowerCase(), b.handle);
      const deviceId = b.platform ? await c.identity.registerDevice(session.userId, b.platform, "dev") : null;
      return { token: await c.identity.issueToken(session), userId: session.userId, profileId: session.profileId, deviceId };
    });
  }

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
