import type { AppConfig, CreateUploadRequest, CreateUploadResponse, DevicePlatform, MediaView, RegisterPushTokenRequest, EventMapResponse, EventSummary, NearbyEventsResponse, SubmitReportRequest, SubmitReportResponse, TimelineEntryView } from "@dizaster/contracts";
import { API_URL } from "./config";
import type { Sender } from "./report/queue";

let token: string | null = null;
export const setToken = (t: string | null) => { token = t; };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw Object.assign(new Error(body.message ?? `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

export const api = {
  config: () => request<AppConfig>("/v1/config"),
  devSignIn: (handle: string, platform: DevicePlatform, deviceId?: string | null) =>
    request<{ token: string; deviceId: string | null }>("/v1/auth/dev", {
      method: "POST",
      body: JSON.stringify({ handle, platform, ...(deviceId ? { deviceId } : {}) }),
    }),
  registerPushToken: (deviceId: string, body: RegisterPushTokenRequest) =>
    request<void>(`/v1/devices/${deviceId}/push-token`, { method: "PUT", body: JSON.stringify(body) }),
  events: (bbox: [number, number, number, number], zoom: number) =>
    request<EventMapResponse>(`/v1/events?bbox=${bbox.map((n) => n.toFixed(5)).join(",")}&zoom=${Math.round(zoom)}`),
  event: (id: string) => request<EventSummary>(`/v1/events/${id}`),
  timeline: (id: string) => request<{ entries: TimelineEntryView[] }>(`/v1/events/${id}/timeline`),
  nearby: (lat: number, lng: number, category: string) =>
    request<NearbyEventsResponse>(`/v1/events/nearby?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&category=${encodeURIComponent(category)}`),
  createUpload: (body: CreateUploadRequest) => request<CreateUploadResponse>("/v1/media/uploads", { method: "POST", body: JSON.stringify(body) }),
  completeUpload: (mediaId: string) => request<{ mediaId: string; state: string }>(`/v1/media/${mediaId}/complete`, { method: "POST" }),
  eventMedia: (eventId: string) => request<{ media: MediaView[] }>(`/v1/events/${eventId}/media`),
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
