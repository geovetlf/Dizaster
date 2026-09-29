/**
 * Proveedor de push detrás de una interfaz: hoy APNs y FCM directos (gratis); mañana otro proveedor sin tocar
 * el Alert Engine. Un mensaje lleva solo datos públicos del EVENT y el deep link.
 */
export interface PushMessage {
  provider: "APNS" | "FCM";
  token: string;
  environment: "development" | "production";
  title: string;
  body: string;
  /** Deep link: dizaster://event/<id> o dizaster://alerts. */
  url: string;
  /** Agrupa y reemplaza avisos del mismo asunto (thread-id / tag / collapse). */
  groupKey: string;
  badge: number;
  /** Confirmación oficial grave: prioridad alta en ambos sistemas. */
  critical: boolean;
  data: Record<string, string>;
}

export interface PushResult {
  token: string;
  ok: boolean;
  /** El sistema dice que el token ya no sirve: hay que olvidarlo. */
  invalidToken: boolean;
  error?: string;
}

export interface PushSender {
  readonly name: string;
  send(messages: PushMessage[]): Promise<PushResult[]>;
}

/** Reparte por proveedor. Si un proveedor no está configurado, sus mensajes fallan sin afectar a los demás. */
export class PushGateway implements PushSender {
  readonly name = "gateway";
  constructor(private readonly senders: { APNS: PushSender | null; FCM: PushSender | null }) {}

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out = new Map<PushMessage, PushResult>();
    for (const provider of ["APNS", "FCM"] as const) {
      const batch = messages.filter((m) => m.provider === provider);
      if (batch.length === 0) continue;
      const sender = this.senders[provider];
      const results = sender
        ? await sender.send(batch).catch((e: Error) => batch.map((m) => ({ token: m.token, ok: false, invalidToken: false, error: e.message })))
        : batch.map((m) => ({ token: m.token, ok: false, invalidToken: false, error: `${provider} no configurado` }));
      batch.forEach((m, i) => out.set(m, results[i] ?? { token: m.token, ok: false, invalidToken: false, error: "sin respuesta" }));
    }
    return messages.map((m) => out.get(m)!);
  }
}

/** Desarrollo: no envía nada, deja constancia en el log (sin el token completo). */
export class LogPushSender implements PushSender {
  readonly name = "log";
  readonly sent: PushMessage[] = [];
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    for (const m of messages) {
      this.sent.push(m);
      this.log(JSON.stringify({ msg: "push.dev", provider: m.provider, token: `${m.token.slice(0, 6)}…`, title: m.title, url: m.url }));
    }
    return messages.map((m) => ({ token: m.token, ok: true, invalidToken: false }));
  }
}

/** Ejecuta `fn` sobre `items` con concurrencia limitada. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
