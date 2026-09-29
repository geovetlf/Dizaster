import { z } from "zod";
import * as C from "@dizaster/contracts";

/**
 * Contrato OpenAPI 3.1 de la API (Blueprint §4.3, ADR 0052), generado desde los esquemas zod de `@dizaster/contracts`:
 * la misma fuente valida en el servidor y tipa la app, así que no se desincroniza. Toda ruta registrada debe tener
 * una entrada aquí (lo exige una prueba). Donde la respuesta es solo un tipo TypeScript, se documenta sin esquema.
 */
export interface Operation {
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  response?: z.ZodType;
}

export const OPERATIONS: Record<string, Operation> = {
  "GET /health": { summary: "Estado del proceso" },
  "GET /v1/config": { summary: "Configuración remota: proveedor de mapa, interruptores y límites", response: C.AppConfig },
  "GET /v1/openapi.json": { summary: "Este contrato" },
  "GET /v1/reference/categories": { summary: "Catálogo de categorías", response: C.CategoryCatalog },
  "GET /v1/search/posts": { summary: "Buscar publicaciones por texto (sin IA)", query: C.PostSearchQuery },
  "GET /v1/search/events": { summary: "Buscar eventos por categoría, lugar o título (sin IA)", query: C.EventSearchQuery, response: C.EventSearchResponse },
  "GET /v1/reference/emergency-numbers": { summary: "Números de emergencia (con ?since para no descargar si no cambió)", response: C.EmergencyNumbersResponse },
  "GET /v1/geo/country": { summary: "País de un punto" },
  "GET /v1/geo/areas": { summary: "Búsqueda de lugares en el índice abierto propio", query: C.AreaSearchQuery },
  "GET /v1/geo/datasets": { summary: "Datasets geográficos importados y sus licencias" },
  "GET /v1/about/attributions": { summary: "Atribuciones y licencias de datos", response: C.AttributionsResponse },
  "POST /v1/auth/dev": { summary: "Inicio de sesión de desarrollo (solo si DEV_AUTH_ENABLED)" },
  "POST /v1/auth/refresh": { summary: "Renovar la sesión" },
  "POST /v1/auth/logout": { summary: "Cerrar la sesión" },
  "GET /v1/me/sessions": { summary: "Sesiones abiertas" },
  "DELETE /v1/me/sessions/:id": { summary: "Cerrar una sesión" },
  "POST /v1/me/sessions/revoke-others": { summary: "Cerrar las demás sesiones" },
  "PUT /v1/devices/:id/push-token": { summary: "Registrar el token de avisos del dispositivo", body: C.RegisterPushTokenRequest },
  "DELETE /v1/devices/:id/push-token": { summary: "Quitar el token de avisos" },
  "POST /v1/reports": { summary: "Enviar un reporte con prueba de presencia", body: C.SubmitReportRequest, response: C.SubmitReportResponse },
  "GET /v1/events": { summary: "Eventos del mapa por bbox y zoom (filtros: categorías, verificados, ventana 6h/24h/7d)", response: C.EventMapResponse },
  "GET /v1/events/tiles/:z/:x/:y": { summary: "Eventos del mapa por tesela z/x/y, cacheable en CDN (ADR 0078)", response: C.EventMapResponse },
  "GET /v1/events/nearby": { summary: "Eventos cercanos a un punto", response: C.NearbyEventsResponse },
  "GET /v1/events/:id": { summary: "Detalle de un evento", response: C.EventSummary },
  "GET /v1/events/:id/timeline": { summary: "Línea de tiempo de un evento (por páginas)", query: C.ChronoPageQuery },
  "GET /v1/events/:id/posts": { summary: "Publicaciones de un evento", query: C.FeedQuery },
  "GET /v1/events/:id/sources": { summary: "Fuentes externas y oficiales del evento, con licencia y enlace" },
  "GET /v1/events/:id/verification": { summary: "Estado de verificación explicado", response: C.VerificationView },
  "GET /v1/events/:id/media": { summary: "Fotos y videos de un evento" },
  "GET /v1/feed": { summary: "Feed", query: C.FeedQuery },
  "GET /v1/profiles": { summary: "Buscar perfiles", query: C.ProfileSearchQuery },
  "GET /v1/profiles/:handle": { summary: "Perfil público" },
  "GET /v1/profiles/:handle/posts": { summary: "Publicaciones de un perfil", query: C.ProfilePostsQuery },
  "GET /v1/me": { summary: "Mi perfil" },
  "PATCH /v1/me": { summary: "Editar mi perfil", body: C.UpdateProfileRequest },
  "PUT /v1/me/avatar": { summary: "Poner o quitar mi foto de perfil", body: C.SetAvatarRequest },
  "DELETE /v1/me": { summary: "Borrar mi cuenta (confirm = DELETE)" },
  "GET /v1/me/export": { summary: "Exportar mis datos" },
  "GET /v1/me/account": { summary: "Roles y estado de edad de la cuenta" },
  "POST /v1/me/age": { summary: "Declarar la edad mínima (no se guarda la fecha)", body: C.ConfirmAgeRequest },
  "GET /v1/me/alert-preferences": { summary: "Preferencias de avisos", response: C.AlertPreferences },
  "PUT /v1/me/alert-preferences": { summary: "Cambiar preferencias de avisos", body: C.UpdateAlertPreferences, response: C.AlertPreferences },
  "GET /v1/me/alert-subscriptions": { summary: "Suscripciones por categoría" },
  "POST /v1/me/alert-subscriptions": { summary: "Suscribirse a una categoría", body: C.CategorySubscriptionInput },
  "DELETE /v1/me/alert-subscriptions/:id": { summary: "Quitar una suscripción" },
  "GET /v1/me/zones": { summary: "Zonas guardadas" },
  "POST /v1/me/zones": { summary: "Guardar una zona", body: C.SavedZoneInput },
  "PUT /v1/me/zones/:id": { summary: "Editar una zona", body: C.SavedZoneInput },
  "DELETE /v1/me/zones/:id": { summary: "Borrar una zona" },
  "PUT /v1/me/approximate-location": { summary: "Ubicación aproximada para avisos cerca de mí", body: C.ApproximateLocationRequest },
  "DELETE /v1/me/approximate-location": { summary: "Olvidar la ubicación aproximada" },
  "GET /v1/me/notifications": { summary: "Bandeja de avisos", query: C.NotificationsQuery },
  "POST /v1/me/notifications/read": { summary: "Marcar avisos como leídos" },
  "GET /v1/me/follows": { summary: "Lo que sigo" },
  "PUT /v1/follows/:target/:id": { summary: "Seguir" },
  "DELETE /v1/follows/:target/:id": { summary: "Dejar de seguir" },
  "POST /v1/posts": { summary: "Publicar sin reporte", body: C.CreatePostRequest },
  "POST /v1/posts/:id/share": { summary: "Compartir dentro de la app", body: C.SharePostRequest },
  "DELETE /v1/posts/:id": { summary: "Borrar mi publicación" },
  "PUT /v1/posts/:id/like": { summary: "Me gusta" },
  "DELETE /v1/posts/:id/like": { summary: "Quitar me gusta" },
  "PUT /v1/posts/:id/reactions/:kind": { summary: "Reacción de contexto" },
  "DELETE /v1/posts/:id/reactions/:kind": { summary: "Quitar reacción" },
  "GET /v1/posts/:id": { summary: "Una publicación por enlace (ADR 0083)" },
  "GET /v1/posts/:id/comments": { summary: "Comentarios (por páginas)", query: C.ChronoPageQuery },
  "POST /v1/posts/:id/comments": { summary: "Comentar o responder", body: C.CreateCommentRequest },
  "DELETE /v1/comments/:id": { summary: "Borrar mi comentario" },
  "PUT /v1/comments/:id/reactions/:kind": { summary: "Reaccionar a un comentario" },
  "DELETE /v1/comments/:id/reactions/:kind": { summary: "Quitar reacción a un comentario" },
  "POST /v1/businesses": { summary: "Crear un perfil de negocio", body: C.CreateBusinessRequest },
  "GET /v1/businesses": { summary: "Buscar negocios", query: C.BusinessSearchQuery },
  "GET /v1/me/businesses": { summary: "Mis negocios" },
  "GET /v1/businesses/:handle": { summary: "Perfil de negocio" },
  "PUT /v1/businesses/:handle": { summary: "Editar un negocio", body: C.UpdateBusinessRequest },
  "DELETE /v1/businesses/:handle": { summary: "Borrar un negocio" },
  "PUT /v1/businesses/:handle/logo": { summary: "Poner o quitar el logo de un negocio", body: C.SetAvatarRequest },
  "GET /v1/businesses/:handle/posts": { summary: "Publicaciones de un negocio", query: C.ProfilePostsQuery },
  "PUT /v1/admin/businesses/:handle/verification": { summary: "Verificar un negocio (admin)", body: C.SetBusinessVerificationRequest },
  "PUT /v1/admin/businesses/:handle/official-scope": { summary: "Ámbito de un perfil institucional oficial (ADR 0095)", body: C.OfficialScopeRequest },
  "GET /v1/businesses/:handle/official-scope": { summary: "Qué puede confirmar un perfil institucional (ADR 0095)" },
  "POST /v1/businesses/:handle/official-statements": { summary: "Confirmar o desmentir un evento como institución oficial (ADR 0095)", body: C.OfficialStatementRequest },
  "GET /v1/tags": { summary: "Buscar etiquetas", query: C.TagSearchQuery },
  "GET /v1/tags/:tag": { summary: "Etiqueta" },
  "GET /v1/tags/:tag/posts": { summary: "Publicaciones de una etiqueta", query: C.ProfilePostsQuery },
  "POST /v1/ingest/:sourceKey/push": { summary: "Push firmado (HMAC) de una fuente habilitada; mismo formato que su feed (ADR 0128)" },
  "POST /v1/media/uploads": { summary: "Pedir una subida de foto o video", body: C.CreateUploadRequest },
  "POST /v1/media/:id/complete": { summary: "Confirmar una subida" },
  "GET /v1/media/:id": { summary: "Estado y enlaces de una media" },
  "GET /v1/admin/cost": { summary: "Tablero de costo (admin)", query: C.CostDashboardQuery },
  "GET /v1/admin/quality": { summary: "Métricas de calidad (admin)", query: C.QualityQuery },
  "PUT /v1/admin/cost/budgets/:key": { summary: "Cambiar un presupuesto (admin)", body: C.UpdateBudgetRequest },
  "GET /v1/admin/categories/:code/publish-delay": { summary: "Retraso de publicación de una categoría (admin, ADR 0109)" },
  "PUT /v1/admin/categories/:code/publish-delay": { summary: "Cambiar el retraso de publicación (admin, ADR 0109)", body: C.SetPublishDelayRequest },
  "PUT /v1/admin/kill-switches/:feature": { summary: "Interruptor de una función costosa (admin)", body: C.UpdateKillSwitchRequest },
  "POST /v1/flags": { summary: "Denunciar contenido", body: C.CreateFlagRequest },
  "PUT /v1/blocks/:handle": { summary: "Bloquear un perfil" },
  "DELETE /v1/blocks/:handle": { summary: "Desbloquear" },
  "GET /v1/me/blocks": { summary: "Perfiles bloqueados" },
  "GET /v1/me/moderation": { summary: "Decisiones de moderación sobre mi contenido" },
  "GET /v1/me/reports": { summary: "Mis reportes y qué pasó con cada uno (ADR 0094)" },
  "DELETE /v1/me/reports/:id": { summary: "Retirar un reporte propio (ADR 0094)" },
  "POST /v1/me/moderation/:id/appeal": { summary: "Apelar una decisión", body: C.AppealRequest },
  "GET /v1/moderation/cases": { summary: "Cola de casos (moderación)", query: C.CaseQueueQuery },
  "GET /v1/moderation/cases/:id": { summary: "Detalle de un caso" },
  "GET /v1/me/mfa": { summary: "Estado del segundo factor (personal)" },
  "POST /v1/me/mfa/totp": { summary: "Generar un autenticador TOTP (personal)" },
  "POST /v1/me/mfa/totp/confirm": { summary: "Confirmar el autenticador y recibir códigos de recuperación", body: C.MfaCodeRequest },
  "POST /v1/me/mfa/verify": { summary: "Verificar esta sesión con TOTP o código de recuperación", body: C.MfaVerifyRequest },
  "POST /v1/me/mfa/totp/disable": { summary: "Desactivar el autenticador (exige un código)", body: C.MfaCodeRequest },
  "POST /v1/moderation/posts/:id/presence": { summary: "Ver la evidencia de presencia de un reporte, con motivo auditado (moderación)", body: C.PresenceReviewRequest },
  "GET /v1/admin/presence-access": { summary: "Registro de accesos a evidencia de presencia (admin)" },
  "POST /v1/moderation/cases/:id/actions": { summary: "Tomar una acción", body: C.TakeActionRequest },
  "GET /v1/moderation/appeals": { summary: "Apelaciones" },
  "POST /v1/moderation/appeals/:id/decision": { summary: "Decidir una apelación", body: C.DecideAppealRequest },
  "GET /v1/moderation/events/:id": { summary: "Evento visto por moderación" },
  "POST /v1/moderation/events/:id/merge": { summary: "Fusionar eventos", body: C.MergeEventsRequest },
  "POST /v1/moderation/merges/:id/revert": { summary: "Revertir una fusión", body: C.RevertMergeRequest },
  "GET /v1/moderation/duplicates": { summary: "Cola de posibles eventos duplicados (ADR 0076)" },
  "POST /v1/moderation/duplicates/:id/dismiss": { summary: "Descartar un posible duplicado", body: C.DismissDuplicateRequest },
  "POST /v1/moderation/events/:id/split": { summary: "Separar un evento", body: C.SplitEventRequest },
  "POST /v1/moderation/events/:id/status": { summary: "Cambiar el ciclo de vida de un evento", body: C.SetEventStatusRequest },
  "POST /v1/moderation/events/:id/negative-state": { summary: "Marcar un evento en disputa o falso" },
};

/** Las lecturas son públicas salvo lo personal y lo de administración; las escrituras piden sesión (salvo iniciarla). */
function needsSession(method: string, path: string): boolean {
  if (/^\/v1\/(me|admin|moderation)(\/|$)/.test(path)) return true;
  if (/^\/v1\/auth\/(dev|refresh)$/.test(path)) return false;
  return method !== "GET" && path.startsWith("/v1/");
}

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>;

function queryParameters(s: z.ZodType): unknown[] {
  const js = schema(s) as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(js.properties ?? {}).map(([name, p]) => ({ name, in: "query", required: js.required?.includes(name) ?? false, schema: p }));
}

/** Documento OpenAPI; `routes` son las rutas registradas ("GET /v1/…"). Las no documentadas salen marcadas. */
export function buildOpenApi(routes: readonly string[], version: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  // El almacenamiento local de desarrollo imita un bucket: no es parte de la API.
  const own = routes.filter((r) => !r.includes(" /v1/dev-storage/"));
  for (const key of [...new Set([...own, ...Object.keys(OPERATIONS)])].sort()) {
    const [method, path] = key.split(" ") as [string, string];
    const op = OPERATIONS[key];
    const params = [...path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const entry: Record<string, unknown> = {
      summary: op?.summary ?? "",
      tags: [path.split("/")[path.startsWith("/v1/") ? 2 : 1] ?? "root"],
      parameters: [...params, ...(op?.query ? queryParameters(op.query) : [])],
      responses: { "2XX": { description: "OK", ...(op?.response ? { content: { "application/json": { schema: schema(op.response) } } } : {}) }, default: { $ref: "#/components/responses/Error" } },
    };
    if (op?.body) entry.requestBody = { required: true, content: { "application/json": { schema: schema(op.body) } } };
    if (needsSession(method, path)) entry.security = [{ bearer: [] }];
    if (!op) entry["x-undocumented"] = true;
    (paths[path.replace(/:([A-Za-z]+)/g, "{$1}")] ??= {})[method.toLowerCase()] = entry;
  }
  return {
    openapi: "3.1.0",
    info: { title: "Dizaster API", version },
    servers: [{ url: "/" }],
    paths,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      responses: {
        Error: {
          description: "Error con código estable",
          content: { "application/json": { schema: { type: "object", required: ["error", "message"], properties: { error: { type: "string" }, message: { type: "string" } } } } },
        },
      },
    },
  };
}
