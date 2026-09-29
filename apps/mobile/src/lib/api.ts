import type { EventSourceView, EventStatus, MyProfile, UpdateProfileRequest, ReactionKind, ReactionState, DataExport, VerificationView, ModeratorEventDetail, SavedZone, SavedZoneInput, AppealView, CaseDetail, CaseSummary, CreateFlagRequest, ModerationActionType, ModerationNotice, CostDashboard, KillSwitchView, QualityReport, CreatePostRequest, TagView, BusinessView, SessionView, CreateBusinessRequest, UpdateBusinessRequest, AlertPreferences, CategorySubscription, CategorySubscriptionInput, NotificationsResponse, AppConfig, AttributionsResponse, AreaSearchResult, FollowTarget, MyFollows, ProfileSearchResult, ProfileView, CommentView, CreateUploadRequest, FeedResponse, FeedTab, CreateUploadResponse, DevicePlatform, MediaView, RegisterPushTokenRequest, EventMapResponse, EventSummary, NearbyEventsResponse, SubmitReportRequest, SubmitReportResponse, TimelineEntryView } from "@dizaster/contracts";
import { canRetryWithRefresh, singleFlight } from "./auth/refresh";
import { API_URL } from "./config";
import type { Sender } from "./report/queue";

export interface TokenPair { token: string; refreshToken: string; expiresIn: number }

let token: string | null = null;
let refreshToken: string | null = null;
let listeners: { rotated?: (refreshToken: string) => void; lost?: () => void } = {};

/** Sesión actual. `null` al borrar la cuenta. */
export function setSession(pair: Pick<TokenPair, "token" | "refreshToken"> | null) {
  token = pair?.token ?? null;
  refreshToken = pair?.refreshToken ?? null;
}

/** `rotated`: guardar el refresh nuevo en el almacén seguro. `lost`: la sesión no se pudo renovar. */
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

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const auth: Record<string, string> = token && !path.startsWith("/v1/auth/") ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Sin cuerpo no se declara JSON: el servidor rechaza un cuerpo JSON vacío (p. ej. DELETE o POST .../complete).
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...auth, ...(init.headers ?? {}) },
  });
  if (canRetryWithRefresh(path, res.status, retried, refreshToken !== null) && (await renew())) return request<T>(path, init, true);
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw Object.assign(new Error(body.message ?? `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

export const api = {
  config: () => request<AppConfig>("/v1/config"),
  attributions: () => request<AttributionsResponse>("/v1/about/attributions"),
  devSignIn: (handle: string, platform: DevicePlatform, deviceId?: string | null) =>
    request<TokenPair & { deviceId: string | null }>("/v1/auth/dev", {
      method: "POST",
      body: JSON.stringify({ handle, platform, ...(deviceId ? { deviceId } : {}) }),
    }),
  refresh: (refreshToken: string) => request<TokenPair>("/v1/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken }) }),
  logout: (refreshToken: string) => request<void>("/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken }) }),
  /** Irreversible. La pantalla exige escribir la palabra de confirmación antes de llamarlo. */
  deleteAccount: () => request<{ status: string }>("/v1/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }),
  registerPushToken: (deviceId: string, body: RegisterPushTokenRequest) =>
    request<void>(`/v1/devices/${deviceId}/push-token`, { method: "PUT", body: JSON.stringify(body) }),
  events: (bbox: [number, number, number, number], zoom: number, filter = "") =>
    request<EventMapResponse>(`/v1/events?bbox=${bbox.map((n) => n.toFixed(5)).join(",")}&zoom=${Math.round(zoom)}${filter}`),
  event: (id: string) => request<EventSummary>(`/v1/events/${id}`),
  verification: (id: string) => request<VerificationView>(`/v1/events/${id}/verification`),
  eventSources: (id: string) => request<{ sources: EventSourceView[] }>(`/v1/events/${id}/sources`),
  timeline: (id: string) => request<{ entries: TimelineEntryView[] }>(`/v1/events/${id}/timeline`),
  nearby: (lat: number, lng: number, category: string) =>
    request<NearbyEventsResponse>(`/v1/events/nearby?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&category=${encodeURIComponent(category)}`),
  createUpload: (body: CreateUploadRequest) => request<CreateUploadResponse>("/v1/media/uploads", { method: "POST", body: JSON.stringify(body) }),
  completeUpload: (mediaId: string) => request<{ mediaId: string; state: string }>(`/v1/media/${mediaId}/complete`, { method: "POST" }),
  eventMedia: (eventId: string) => request<{ media: MediaView[] }>(`/v1/events/${eventId}/media`),
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
  comments: (postId: string) => request<{ comments: CommentView[] }>(`/v1/posts/${postId}/comments`),
  addComment: (postId: string, text: string, parentId?: string) =>
    request<CommentView>(`/v1/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ text, ...(parentId ? { parentId } : {}) }) }),
  deleteComment: (commentId: string) => request<void>(`/v1/comments/${commentId}`, { method: "DELETE" }),
  setCommentReaction: (commentId: string, kind: "LIKE" | "SUPPORT" | "USEFUL", on: boolean) =>
    request<ReactionState>(`/v1/comments/${commentId}/reactions/${kind}`, { method: on ? "PUT" : "DELETE" }),
  /** Lugares del índice geográfico propio. La ubicación, si se envía, va redondeada (~1 km) solo para ordenar. */
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
  searchProfiles: (q: string) => request<{ profiles: ProfileSearchResult[] }>(`/v1/profiles?${new URLSearchParams({ q })}`),
  alertPreferences: () => request<AlertPreferences>("/v1/me/alert-preferences"),
  updateAlertPreferences: (patch: Partial<AlertPreferences>) =>
    request<AlertPreferences>("/v1/me/alert-preferences", { method: "PUT", body: JSON.stringify(patch) }),
  alertSubscriptions: () => request<{ subscriptions: CategorySubscription[] }>("/v1/me/alert-subscriptions"),
  addAlertSubscription: (body: Partial<CategorySubscriptionInput> & Pick<CategorySubscriptionInput, "categoryCode" | "areaId">) =>
    request<CategorySubscription>("/v1/me/alert-subscriptions", { method: "POST", body: JSON.stringify(body) }),
  removeAlertSubscription: (id: string) => request<void>(`/v1/me/alert-subscriptions/${id}`, { method: "DELETE" }),
  zones: () => request<{ zones: SavedZone[] }>("/v1/me/zones"),
  addZone: (body: Omit<SavedZoneInput, "radiusKm"> & { radiusKm?: number }) =>
    request<SavedZone>("/v1/me/zones", { method: "POST", body: JSON.stringify(body) }),
  removeZone: (id: string) => request<void>(`/v1/me/zones/${id}`, { method: "DELETE" }),
  setApproximateLocation: (p: { lat: number; lng: number }) =>
    request<{ stored: boolean }>("/v1/me/approximate-location", { method: "PUT", body: JSON.stringify(p) }),
  notifications: (cursor?: string | null, limit = 20) =>
    request<NotificationsResponse>(`/v1/me/notifications?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`),
  /** Sin ids: marca todo como leído. */
  markNotificationsRead: (ids?: string[]) =>
    request<{ unread: number }>("/v1/me/notifications/read", { method: "POST", ...(ids ? { body: JSON.stringify({ ids }) } : {}) }),
  flag: (body: CreateFlagRequest) => request<{ received: boolean }>("/v1/flags", { method: "POST", body: JSON.stringify(body) }),
  block: (handle: string, on: boolean) =>
    request<{ blocked: boolean }>(`/v1/blocks/${encodeURIComponent(handle)}`, { method: on ? "PUT" : "DELETE" }),
  myModeration: () => request<{ notices: ModerationNotice[] }>("/v1/me/moderation"),
  appeal: (actionId: string, text: string) =>
    request<ModerationNotice>(`/v1/me/moderation/${actionId}/appeal`, { method: "POST", body: JSON.stringify({ text }) }),
  moderationQueue: (cursor?: string | null) =>
    request<{ cases: CaseSummary[]; nextCursor: string | null }>(`/v1/moderation/cases${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  moderationCase: (id: string) => request<CaseDetail>(`/v1/moderation/cases/${id}`),
  moderationAct: (id: string, action: ModerationActionType, reason: string) =>
    request<CaseDetail>(`/v1/moderation/cases/${id}/actions`, { method: "POST", body: JSON.stringify({ action, reason }) }),
  appeals: () => request<{ appeals: AppealView[] }>("/v1/moderation/appeals"),
  moderatorEvent: (id: string) => request<ModeratorEventDetail>(`/v1/moderation/events/${id}`),
  mergeEvents: (targetId: string, sourceEventIds: string[], reason: string) =>
    request<{ mergeIds: string[]; event: ModeratorEventDetail }>(`/v1/moderation/events/${targetId}/merge`, { method: "POST", body: JSON.stringify({ sourceEventIds, reason }) }),
  revertMerge: (mergeId: string, reason: string) =>
    request<{ targetEventId: string; restoredEventId: string }>(`/v1/moderation/merges/${mergeId}/revert`, { method: "POST", body: JSON.stringify({ reason }) }),
  setEventStatus: (id: string, to: EventStatus, reason: string) =>
    request<ModeratorEventDetail>(`/v1/moderation/events/${id}/status`, { method: "POST", body: JSON.stringify({ to, reason }) }),
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
    const retryable = status === undefined || status >= 500 || status === 429;
    return { ok: false, retryable, error: (err as Error).message };
  }
};
