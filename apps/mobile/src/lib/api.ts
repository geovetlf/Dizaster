import type { AcceptPoliciesRequest, PolicyStatusResponse, ClientCrashReport, ClientCrashesResponse, AdminSourcesResponse, OriginalAccessEntry, OriginalAccessGrant, ChangeRoleRequest, StaffResponse, TransparencyReport, AuthorityRequestDetail, AuthorityRequestSummary, AuthorityRequestStatus, CreateAuthorityRequest, PublishDelayView, PresenceAccessEntry, DuplicateCandidateView, OfficialScopeView, MyReportView, MfaEnrollResponse, MfaStatus, PresenceReview, EventSourceView, EventStatus, MyProfile, UpdateProfileRequest, ReactionKind, ReactionState, DataExport, VerificationView, ModeratorEventDetail, SavedZone, SavedZoneInput, AppealView, CaseDetail, CaseSummary, CreateFlagRequest, ModerationActionType, ModerationNotice, CostDashboard, KillSwitchView, QualityReport, CreatePostRequest, TagView, BusinessView, SessionView, CreateBusinessRequest, UpdateBusinessRequest, AlertPreferences, CategorySubscription, CategorySubscriptionInput, NotificationsResponse, AppConfig, AttributionsResponse, AreaSearchResult, FollowTarget, MyFollows, ProfileSearchResult, ProfileView, CommentView, CreateUploadRequest, FeedPost, FeedResponse, FeedTab, CreateUploadResponse, DevicePlatform, MediaView, RegisterPushTokenRequest, EventMapResponse, EventDetail, EventSummary, NearbyEventsResponse, SubmitReportRequest, SubmitReportResponse, TimelineEntryView } from "@dizaster/contracts";
import { mergeMapTiles, tilesForView } from "@dizaster/geo-kit";
import { canRetryWithRefresh, singleFlight } from "./auth/refresh";
import { appVersionHeaders } from "./app-identity";
import { fetchWithTimeout } from "./async/timeout";
import { API_URL } from "./config";
import { newId } from "./ids";
import { EtagCache } from "./http/etag-cache";
import { isMfaError } from "./auth/mfa";
import { serverErrorMessage } from "./errors/server-error";
import { lang, t } from "./i18n";
import { pageQuery } from "./ui/pages";
import type { Sender } from "./report/queue";

/** Comentarios por página (ADR 0106). */
const COMMENTS_PAGE = 50;

export interface TokenPair { token: string; refreshToken: string; expiresIn: number }

let token: string | null = null;
let refreshToken: string | null = null;
let listeners: { rotated?: (refreshToken: string) => void; lost?: () => void; mfa?: () => void } = {};

/** Sesión actual. `null` al borrar la cuenta. */
export function setSession(pair: Pick<TokenPair, "token" | "refreshToken"> | null) {
  // Al cerrar o perder la sesión se vacía la caché condicional: la próxima cuenta no ve respuestas de la anterior.
  if (!pair) etags.clear();
  token = pair?.token ?? null;
  refreshToken = pair?.refreshToken ?? null;
}

/** Hay sesión en memoria (la tarea en segundo plano solo envía con la app viva y con sesión, ADR 0190). */
export const hasSession = () => token !== null;

/** `rotated`: guardar el refresh nuevo. `lost`: la sesión no se pudo renovar. `mfa`: moderación pide el segundo factor. */
export function onSessionEvents(l: typeof listeners) { listeners = l; }

/** Renueva con el refresh rotatorio. Una sola renovación en vuelo aunque fallen varias peticiones a la vez. */
const renew = singleFlight(async (): Promise<boolean> => {
  if (!refreshToken) return false;
  try {
    const pair = await api.refresh(refreshToken);
    setSession(pair);
    listeners.rotated?.(pair.refreshToken);
    return true;
  } catch (err) {
    // Sin red no se pierde la sesión: se reintentará en la próxima petición.
    if ((err as { status?: number }).status === 401) { setSession(null); listeners.lost?.(); }
    return false;
  }
});

/**
 * Rutas que viajan sin sesión: las de autenticación y las teselas del mapa, que así la CDN puede compartir entre
 * todos (una petición con `Authorization` no se cachea en una CDN compartida, ADR 0078).
 */
const NO_AUTH_PREFIXES = ["/v1/auth/", "/v1/events/tiles/", "/v1/client-crashes"];

/** GET condicionales con ETag (ADR 0084): un 304 reutiliza el cuerpo ya descargado. */
const etags = new EtagCache();

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const auth: Record<string, string> = token && !NO_AUTH_PREFIXES.some((p) => path.startsWith(p)) ? { authorization: `Bearer ${token}` } : {};
  const isGet = (init.method ?? "GET") === "GET";
  // Id de correlación (ADR 0172): el servidor lo propaga a sus eventos y lo devuelve; queda en el error si falla.
  const requestId = newId();
  const res = await fetchWithTimeout(`${API_URL}${path}`, {
    ...init,
    // Sin cuerpo no se declara JSON: el servidor rechaza un cuerpo JSON vacío (p. ej. DELETE o POST .../complete).
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), "x-request-id": requestId, ...appVersionHeaders, ...auth, ...(isGet ? etags.headers(path) : {}), ...(init.headers ?? {}) },
  });
  if (canRetryWithRefresh(path, res.status, retried, refreshToken !== null) && (await renew())) return request<T>(path, init, true);
  if (res.status === 304 && isGet) {
    const cached = etags.hit(path);
    if (cached !== undefined) return cached as T;
  }
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (res.status === 403 && isMfaError(body)) listeners.mfa?.();
  if (!res.ok) throw Object.assign(new Error(serverErrorMessage(body, res.status, lang, t)), { status: res.status, body, requestId: res.headers.get("x-request-id") ?? requestId });
  if (isGet) etags.store(path, res.headers.get("etag"), body);
  return body;
}

export const api = {
  config: () => request<AppConfig>("/v1/config"),
  /** Términos y políticas (ADR 0176). */
  policies: () => request<PolicyStatusResponse>("/v1/me/policies"),
  acceptPolicies: (body: AcceptPoliciesRequest) => request<void>("/v1/me/policies/accept", { method: "POST", body: JSON.stringify(body) }),
  /** Fallos de la app (ADR 0173): sin sesión, ya redactados. */
  clientCrashes: (entries: ClientCrashReport["entries"]) => request<void>("/v1/client-crashes", { method: "POST", body: JSON.stringify({ entries }) }),
  adminClientCrashes: (days = 7) => request<ClientCrashesResponse>(`/v1/admin/client-crashes?days=${days}`),
  attributions: () => request<AttributionsResponse>("/v1/about/attributions"),
  devSignIn: (handle: string, platform: DevicePlatform, deviceId?: string | null, hardwareId?: string | null) =>
    request<TokenPair & { deviceId: string | null }>("/v1/auth/dev", {
      method: "POST",
      body: JSON.stringify({ handle, platform, ...(deviceId ? { deviceId } : {}), ...(hardwareId ? { hardwareId } : {}) }),
    }),
  emailStart: (email: string) => request<void>("/v1/auth/email/start", { method: "POST", body: JSON.stringify({ email: email.trim() }) }),
  emailVerify: (email: string, code: string, platform: DevicePlatform, deviceId?: string | null, hardwareId?: string | null) =>
    request<TokenPair & { deviceId: string | null }>("/v1/auth/email/verify", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), code, platform, ...(deviceId ? { deviceId } : {}), ...(hardwareId ? { hardwareId } : {}) }),
    }),
  myIdentities: () => request<{ providers: string[] }>("/v1/me/identities"),
  linkEmail: (email: string, code: string) =>
    request<void>("/v1/me/identities", { method: "POST", body: JSON.stringify({ provider: "EMAIL", email: email.trim(), code }) }),
  refresh: (refreshToken: string) => request<TokenPair>("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) }),
  logout: (refreshToken: string) => request<void>("/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }),
  /** Irreversible. La pantalla exige escribir la palabra de confirmación antes de llamarlo. */
  deleteAccount: () => request<{ status: string }>("/v1/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }),
  registerPushToken: (deviceId: string, body: RegisterPushTokenRequest) =>
    request<void>(`/v1/devices/${deviceId}/push-token`, { method: "PUT", body: JSON.stringify(body) }),
  /** Clave pública que firma la evidencia de los reportes (ADR 0129). */
  registerSigningKey: (deviceId: string, publicKey: string) =>
    request<void>(`/v1/devices/${deviceId}/signing-key`, { method: "PUT", body: JSON.stringify({ publicKey }) }),
  events: (bbox: [number, number, number, number], zoom: number, filter = "") =>
    request<EventMapResponse>(`/v1/events?bbox=${bbox.map((n) => n.toFixed(5)).join(",")}&zoom=${Math.round(zoom)}${filter}`),
  /** Capa del mapa por teselas z/x/y (ADR 0078): URLs iguales para la misma zona, cacheables en la CDN. */
  eventTiles: async (bbox: [number, number, number, number], zoom: number, filter = ""): Promise<EventMapResponse> => {
    const qs = filter ? `?${filter.replace(/^&/, "")}` : "";
    const parts = await Promise.all(
      tilesForView(bbox, zoom).map((t) => request<EventMapResponse>(`/v1/events/tiles/${t.z}/${t.x}/${t.y}${qs}`)),
    );
    return mergeMapTiles(parts);
  },
  event: (id: string) => request<EventDetail>(`/v1/events/${id}`),
  post: (id: string) => request<FeedPost>(`/v1/posts/${id}`),
  verification: (id: string) => request<VerificationView>(`/v1/events/${id}/verification`),
  eventSources: (id: string) => request<{ sources: EventSourceView[] }>(`/v1/events/${id}/sources`),
  timeline: (id: string, page: { cursor?: string | null; limit?: number; order?: "asc" | "desc" } = {}) =>
    request<{ entries: TimelineEntryView[]; nextCursor: string | null }>(`/v1/events/${id}/timeline${pageQuery(page)}`),
  nearby: (lat: number, lng: number, category: string) =>
    request<NearbyEventsResponse>(`/v1/events/nearby?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&category=${encodeURIComponent(category)}`),
  createUpload: (body: CreateUploadRequest) => request<CreateUploadResponse>("/v1/media/uploads", { method: "POST", body: JSON.stringify(body) }),
  completeUpload: (mediaId: string) => request<{ mediaId: string; state: string }>(`/v1/media/${mediaId}/complete`, { method: "POST" }),
  mediaState: (mediaId: string) => request<{ mediaId: string; state: string; rejectionReason: string | null }>(`/v1/media/${mediaId}`),
  /** Foto de perfil y logo (ADR 0119): `null` la quita. */
  setAvatar: (mediaId: string | null) => request<MyProfile>("/v1/me/avatar", { method: "PUT", body: JSON.stringify({ mediaId }) }),
  setBusinessLogo: (handle: string, mediaId: string | null) =>
    request<BusinessView>(`/v1/businesses/${encodeURIComponent(handle)}/logo`, { method: "PUT", body: JSON.stringify({ mediaId }) }),
  eventMedia: (eventId: string, cursor?: string) =>
    request<{ media: MediaView[]; nextCursor?: string | null }>(`/v1/events/${eventId}/media${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  feed: (p: { tab: FeedTab; category?: string | null; near?: { lat: number; lng: number } | null; cursor?: string | null }) => {
    const q = new URLSearchParams({ tab: p.tab });
    if (p.category) q.set("category", p.category);
    // Ubicación redondeada (~1 km): basta para "cerca de ti" y no envía la posición exacta.
    if (p.near) { q.set("lat", p.near.lat.toFixed(2)); q.set("lng", p.near.lng.toFixed(2)); }
    if (p.cursor) q.set("cursor", p.cursor);
    return request<FeedResponse>(`/v1/feed?${q}`);
  },
  /** Reacción de contexto (ADR 0040). */
  setReaction: (postId: string, kind: ReactionKind, on: boolean) =>
    request<ReactionState>(`/v1/posts/${postId}/reactions/${kind}`, { method: on ? "PUT" : "DELETE" }),
  comments: (postId: string, cursor: string | null = null) =>
    request<{ comments: CommentView[]; nextCursor: string | null }>(`/v1/posts/${postId}/comments${pageQuery({ limit: COMMENTS_PAGE, cursor })}`),
  /** `clientId` (ADR 0178): el mismo en cada reintento del mismo borrador; así un corte no duplica el comentario. */
  addComment: (postId: string, text: string, parentId?: string, clientId?: string) =>
    request<CommentView>(`/v1/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ text, ...(parentId ? { parentId } : {}), ...(clientId ? { clientId } : {}) }) }),
  deleteComment: (commentId: string) => request<void>(`/v1/comments/${commentId}`, { method: "DELETE" }),
  setCommentReaction: (commentId: string, kind: "LIKE" | "SUPPORT" | "USEFUL", on: boolean) =>
    request<ReactionState>(`/v1/comments/${commentId}/reactions/${kind}`, { method: on ? "PUT" : "DELETE" }),
  /** Lugares del índice geográfico propio. La ubicación, si se envía, va redondeada (~1 km) solo para ordenar. */
  searchEvents: (q: string, near?: { lat: number; lng: number } | null) => {
    const p = new URLSearchParams({ q });
    if (near) { p.set("lat", near.lat.toFixed(2)); p.set("lng", near.lng.toFixed(2)); }
    return request<{ events: EventSummary[] }>(`/v1/search/events?${p}`);
  },
  areas: (q: string, near?: { lat: number; lng: number } | null) => {
    const p = new URLSearchParams({ q });
    if (near) { p.set("lat", near.lat.toFixed(2)); p.set("lng", near.lng.toFixed(2)); }
    return request<{ areas: AreaSearchResult[] }>(`/v1/geo/areas?${p}`);
  },
  me: () => request<MyProfile>("/v1/me"),
  updateMe: (patch: UpdateProfileRequest) => request<MyProfile>("/v1/me", { method: "PATCH", body: JSON.stringify(patch) }),
  profile: (handle: string) => request<ProfileView>(`/v1/profiles/${encodeURIComponent(handle)}`),
  profilePosts: (handle: string, cursor?: string | null) =>
    request<FeedResponse>(`/v1/profiles/${encodeURIComponent(handle)}/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  publishDelay: (code: string) => request<PublishDelayView>(`/v1/admin/categories/${encodeURIComponent(code)}/publish-delay`),
  setPublishDelay: (code: string, minutes: number) =>
    request<PublishDelayView>(`/v1/admin/categories/${encodeURIComponent(code)}/publish-delay`, { method: "PUT", body: JSON.stringify({ minutes }) }),
  answerReportMatch: (reportId: string, answer: "SAME" | "DIFFERENT") =>
    request<{ answer: string }>(`/v1/me/reports/${encodeURIComponent(reportId)}/match`, { method: "POST", body: JSON.stringify({ answer }) }),
  recordExternalShare: (postId: string) => request<void>(`/v1/posts/${encodeURIComponent(postId)}/external-shares`, { method: "POST" }),
  transparency: (days: number) => request<TransparencyReport>(`/v1/admin/transparency?days=${days}`),
  authorityRequests: () => request<{ requests: AuthorityRequestSummary[] }>("/v1/admin/authority-requests"),
  authorityRequest: (id: string) => request<AuthorityRequestDetail>(`/v1/admin/authority-requests/${encodeURIComponent(id)}`),
  createAuthorityRequest: (body: CreateAuthorityRequest) =>
    request<AuthorityRequestDetail>("/v1/admin/authority-requests", { method: "POST", body: JSON.stringify(body) }),
  changeAuthorityRequestStatus: (id: string, status: AuthorityRequestStatus, note: string) =>
    request<AuthorityRequestDetail>(`/v1/admin/authority-requests/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status, note }) }),
  addAuthorityRequestNote: (id: string, note: string) =>
    request<AuthorityRequestDetail>(`/v1/admin/authority-requests/${encodeURIComponent(id)}/notes`, { method: "POST", body: JSON.stringify({ note }) }),
  searchPosts: (q: string) => request<FeedResponse>(`/v1/search/posts?${new URLSearchParams({ q, limit: "10" })}`),
  searchProfiles: (q: string) => request<{ profiles: ProfileSearchResult[] }>(`/v1/profiles?${new URLSearchParams({ q })}`),
  alertPreferences: () => request<AlertPreferences>("/v1/me/alert-preferences"),
  updateAlertPreferences: (patch: Partial<AlertPreferences>) =>
    request<AlertPreferences>("/v1/me/alert-preferences", { method: "PUT", body: JSON.stringify(patch) }),
  alertSubscriptions: () => request<{ subscriptions: CategorySubscription[] }>("/v1/me/alert-subscriptions"),
  addAlertSubscription: (body: Partial<CategorySubscriptionInput> & Pick<CategorySubscriptionInput, "categoryCode" | "areaId">) =>
    request<CategorySubscription>("/v1/me/alert-subscriptions", { method: "POST", body: JSON.stringify(body) }),
  removeAlertSubscription: (id: string) => request<void>(`/v1/me/alert-subscriptions/${id}`, { method: "DELETE" }),
  zones: () => request<{ zones: SavedZone[] }>("/v1/me/zones"),
  addZone: (body: Omit<SavedZoneInput, "radiusKm" | "minSeverity" | "categories"> & { radiusKm?: number; minSeverity?: number; categories?: string[] }) =>
    request<SavedZone>("/v1/me/zones", { method: "POST", body: JSON.stringify(body) }),
  updateZone: (id: string, body: Omit<SavedZoneInput, "radiusKm" | "minSeverity" | "categories"> & { radiusKm?: number; minSeverity?: number; categories?: string[] }) =>
    request<SavedZone>(`/v1/me/zones/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  removeZone: (id: string) => request<void>(`/v1/me/zones/${id}`, { method: "DELETE" }),
  setApproximateLocation: (p: { lat: number; lng: number }) =>
    request<{ stored: boolean }>("/v1/me/approximate-location", { method: "PUT", body: JSON.stringify(p) }),
  notifications: (cursor?: string | null, limit = 20) =>
    request<NotificationsResponse>(`/v1/me/notifications?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`),
  /** Sin ids: marca todo como leído. */
  markNotificationsRead: (ids?: string[]) =>
    request<{ unread: number }>("/v1/me/notifications/read", { method: "POST", ...(ids ? { body: JSON.stringify({ ids }) } : {}) }),
  flag: (body: CreateFlagRequest) => request<{ received: boolean }>("/v1/flags", { method: "POST", body: JSON.stringify(body) }),
  myBlocks: () => request<{ handles: string[] }>("/v1/me/blocks"),
  block: (handle: string, on: boolean) =>
    request<{ blocked: boolean }>(`/v1/blocks/${encodeURIComponent(handle)}`, { method: on ? "PUT" : "DELETE" }),
  myModeration: () => request<{ notices: ModerationNotice[] }>("/v1/me/moderation"),
  myReports: () => request<{ reports: MyReportView[] }>("/v1/me/reports"),
  withdrawReport: (reportId: string) => request<void>(`/v1/me/reports/${reportId}`, { method: "DELETE" }),
  appeal: (actionId: string, text: string) =>
    request<ModerationNotice>(`/v1/me/moderation/${actionId}/appeal`, { method: "POST", body: JSON.stringify({ text }) }),
  moderationQueue: (cursor?: string | null) =>
    request<{ cases: CaseSummary[]; nextCursor: string | null }>(`/v1/moderation/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  mfaStatus: () => request<MfaStatus>("/v1/me/mfa"),
  mfaEnroll: () => request<MfaEnrollResponse>("/v1/me/mfa/totp", { method: "POST" }),
  mfaConfirm: (code: string) => request<{ recoveryCodes: string[] }>("/v1/me/mfa/totp/confirm", { method: "POST", body: JSON.stringify({ code }) }),
  mfaVerify: (input: { code: string } | { recoveryCode: string }) => request<{ verifiedUntil: string }>("/v1/me/mfa/verify", { method: "POST", body: JSON.stringify(input) }),
  moderationPresence: (postId: string, reason: string, caseId?: string) =>
    request<PresenceReview>(`/v1/moderation/posts/${postId}/presence`, { method: "POST", body: JSON.stringify({ reason, ...(caseId ? { caseId } : {}) }) }),
  moderationCase: (id: string) => request<CaseDetail>(`/v1/moderation/cases/${id}`),
  /** Tomar un caso por 15 min (ADR 0134): nadie más actúa mientras tanto. */
  moderationClaim: (id: string) => request<CaseDetail>(`/v1/moderation/cases/${id}/claim`, { method: "POST" }),
  moderationRelease: (id: string) => request<void>(`/v1/moderation/cases/${id}/claim`, { method: "DELETE" }),
  moderationAct: (id: string, action: ModerationActionType, reason: string) =>
    request<CaseDetail>(`/v1/moderation/cases/${id}/actions`, { method: "POST", body: JSON.stringify({ action, reason }) }),
  appeals: () => request<{ appeals: AppealView[] }>("/v1/moderation/appeals"),
  moderatorEvent: (id: string) => request<ModeratorEventDetail>(`/v1/moderation/events/${id}`),
  setNegativeState: (id: string, to: "NONE" | "DISPUTED" | "FALSE", reason: string, evidenceRefs: string[]) =>
    request<VerificationView>(`/v1/moderation/events/${id}/negative-state`, { method: "POST", body: JSON.stringify({ to, reason, evidenceRefs }) }),
  duplicateQueue: () => request<{ candidates: DuplicateCandidateView[] }>("/v1/moderation/duplicates"),
  dismissDuplicate: (id: string, reason: string) =>
    request<void>(`/v1/moderation/duplicates/${id}/dismiss`, { method: "POST", body: JSON.stringify({ reason }) }),
  mergeEvents: (targetId: string, sourceEventIds: string[], reason: string) =>
    request<{ mergeIds: string[]; event: ModeratorEventDetail }>(`/v1/moderation/events/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceEventIds, reason }) }),
  revertMerge: (mergeId: string, reason: string) =>
    request<{ targetEventId: string; restoredEventId: string }>(`/v1/moderation/merges/${mergeId}/revert`, { method: "POST", body: JSON.stringify({ reason }) }),
  addModeratorNote: (id: string, text: string) =>
    request<ModeratorEventDetail>(`/v1/moderation/events/${id}/notes`, { method: "POST", body: JSON.stringify({ text }) }),
  setEventStatus: (id: string, to: EventStatus, reason: string) =>
    request<ModeratorEventDetail>(`/v1/moderation/events/${id}/status`, { method: "POST", body: JSON.stringify({ to, reason }) }),
  moderationOriginal: (mediaId: string, reason: string, caseId?: string) =>
    request<OriginalAccessGrant>(`/v1/moderation/media/${mediaId}/original`, { method: "POST", body: JSON.stringify({ reason, ...(caseId ? { caseId } : {}) }) }),
  originalAccessLog: () => request<{ entries: OriginalAccessEntry[] }>("/v1/admin/media-original-access"),
  adminStaff: () => request<StaffResponse>("/v1/admin/staff"),
  changeRole: (body: ChangeRoleRequest) => request<void>("/v1/admin/staff/roles", { method: "POST", body: JSON.stringify(body) }),
  adminSources: () => request<AdminSourcesResponse>("/v1/admin/sources"),
  setSourceStatus: (key: string, to: "ACTIVE" | "PAUSED", reason: string) =>
    request<void>(`/v1/admin/sources/${encodeURIComponent(key)}/status`, { method: "POST", body: JSON.stringify({ to, reason }) }),
  setEventSeverity: (id: string, severity: number | null, reason: string) =>
    request<ModeratorEventDetail>(`/v1/moderation/events/${id}/severity`, { method: "POST", body: JSON.stringify({ severity, reason }) }),
  /** Solo sube (ADR 0179). */
  raiseEventSensitivity: (id: string, to: "SENSITIVE" | "HIGHLY_SENSITIVE", reason: string) =>
    request<ModeratorEventDetail>(`/v1/moderation/events/${id}/sensitivity`, { method: "POST", body: JSON.stringify({ to, reason }) }),
  splitEvent: (id: string, evidenceIds: string[], reason: string) =>
    request<{ eventId: string }>(`/v1/moderation/events/${id}/split`, { method: "POST", body: JSON.stringify({ evidenceIds, reason }) }),
  decideAppeal: (id: string, decision: "UPHOLD" | "REVERSE", reason: string) =>
    request<AppealView>(`/v1/moderation/appeals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, reason }) }),
  account: () => request<{ roles: string[]; ageConfirmed: boolean; minAge: number }>("/v1/me/account"),
  /** Declarar la edad (ADR 0049). 403 UNDER_MIN_AGE por debajo del mínimo; el servidor no guarda la fecha. */
  confirmAge: (body: { birthYear: number; birthMonth: number; country?: string }) =>
    request<{ ok: true; minAge: number }>("/v1/me/age", { method: "POST", body: JSON.stringify(body) }),
  /** Copia de mis datos (ADR 0038). El servidor limita a una por minuto. */
  exportData: () => request<DataExport>("/v1/me/export"),
  costDashboard: (days = 30) => request<CostDashboard>(`/v1/admin/cost?days=${days}`),
  setBudget: (key: string, period: "DAILY" | "MONTHLY", limitUsd: number) =>
    request<unknown>(`/v1/admin/cost/budgets/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ period, limitUsd }) }),
  setBusinessVerification: (handle: string, verification: BusinessView["verification"]) =>
    request<BusinessView>(`/v1/admin/businesses/${encodeURIComponent(handle)}/verification`, { method: "PUT", body: JSON.stringify({ verification }) }),
  setOfficialScope: (handle: string, categories: string[], countries: string[]) =>
    request<OfficialScopeView>(`/v1/admin/businesses/${encodeURIComponent(handle)}/official-scope`, { method: "PUT", body: JSON.stringify({ categories, countries }) }),
  presenceAccessLog: () => request<{ entries: PresenceAccessEntry[] }>("/v1/admin/presence-access"),
  mfaDisable: (code: string) => request<void>("/v1/me/mfa/totp/disable", { method: "POST", body: JSON.stringify({ code }) }),
  qualityReport: (days = 7) => request<QualityReport>(`/v1/admin/quality?days=${days}`),
  setKillSwitch: (feature: string, killed: boolean) =>
    request<KillSwitchView>(`/v1/admin/kill-switches/${encodeURIComponent(feature)}`, { method: "PUT", body: JSON.stringify({ killed }) }),
  myFollows: () => request<MyFollows>("/v1/me/follows"),
  follow: (target: FollowTarget, id: string, on: boolean) =>
    request<{ following: boolean }>(`/v1/follows/${target}/${encodeURIComponent(id)}`, { method: on ? "PUT" : "DELETE" }),
  /** Compartir dentro de la app (ADR 0046). */
  sharePost: (postId: string, body: { text?: string; anonymityMode?: "PUBLIC" | "PSEUDONYMOUS"; asBusiness?: string }) =>
    request<{ postId: string; sharedPostId: string }>(`/v1/posts/${postId}/share`, { method: "POST", body: JSON.stringify(body) }),
  createPost: (body: Partial<CreatePostRequest> & { text: string }) =>
    request<{ postId: string; eventId: string | null; tags: string[]; mentions: string[] }>("/v1/posts", { method: "POST", body: JSON.stringify(body) }),
  deletePost: (postId: string) => request<void>(`/v1/posts/${postId}`, { method: "DELETE" }),
  editPost: (postId: string, text: string) =>
    request<{ postId: string; editedAt: string }>(`/v1/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ text }) }),
  tag: (tag: string) => request<TagView>(`/v1/tags/${encodeURIComponent(tag)}`),
  eventPosts: (eventId: string, cursor: string | null) =>
    request<FeedResponse>(`/v1/events/${eventId}/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  tagPosts: (tag: string, cursor: string | null) =>
    request<FeedResponse>(`/v1/tags/${encodeURIComponent(tag)}/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  searchTags: (q: string) => request<{ tags: TagView[] }>(`/v1/tags?${new URLSearchParams({ q })}`),
  createBusiness: (body: CreateBusinessRequest) => request<BusinessView>("/v1/businesses", { method: "POST", body: JSON.stringify(body) }),
  updateBusiness: (handle: string, body: UpdateBusinessRequest) =>
    request<BusinessView>(`/v1/businesses/${encodeURIComponent(handle)}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteBusiness: (handle: string) => request<void>(`/v1/businesses/${encodeURIComponent(handle)}`, { method: "DELETE" }),
  business: (handle: string) => request<BusinessView>(`/v1/businesses/${encodeURIComponent(handle)}`),
  businessPosts: (handle: string, cursor: string | null) =>
    request<FeedResponse>(`/v1/businesses/${encodeURIComponent(handle)}/posts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  myBusinesses: () => request<{ businesses: BusinessView[] }>("/v1/me/businesses"),
  officialScope: (handle: string) => request<{ scope: OfficialScopeView | null }>(`/v1/businesses/${encodeURIComponent(handle)}/official-scope`),
  officialStatement: (handle: string, eventId: string, assertion: "OCCURRING" | "NOT_OCCURRING") =>
    request<{ eventId: string; assertion: string }>(`/v1/businesses/${encodeURIComponent(handle)}/official-statements`, { method: "POST", body: JSON.stringify({ eventId, assertion }) }),
  searchBusinesses: (q: string) => request<{ businesses: BusinessView[] }>(`/v1/businesses?${new URLSearchParams({ q })}`),
  sessions: () => request<{ sessions: SessionView[] }>("/v1/me/sessions"),
  revokeSession: (id: string) => request<void>(`/v1/me/sessions/${id}`, { method: "DELETE" }),
  revokeOtherSessions: () => request<{ revoked: number }>("/v1/me/sessions/revoke-others", { method: "POST" }),
  submitReport: (body: SubmitReportRequest) => request<SubmitReportResponse>("/v1/reports", { method: "POST", body: JSON.stringify(body) }),
};

/** Adaptador para la cola offline: red caída o 5xx/429 = reintentable; 4xx = definitivo. */
export const sendReport: Sender = async (body) => {
  try {
    return { ok: true, response: await api.submitReport(body) };
  } catch (err) {
    const status = (err as { status?: number }).status;
    // 401: sesión vencida o revocada; el reporte espera al nuevo inicio de sesión, no se pierde.
    const retryable = status === undefined || status >= 500 || status === 429 || status === 401;
    return { ok: false, retryable, error: (err as Error).message, ...(status === undefined ? { offline: true } : {}) };
  }
};
