const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHORT = new RegExp(`^(?:https?://[^/]+)?/(e|p)/(${UUID})/?(?:[?#].*)?$`, "i");

/**
 * Enlaces compartidos (ADR 0083): https://<dominio>/e/<id> abre el evento y /p/<id> la publicación. Las rutas de
 * la app son /event/<id> y /post/<id>; esto traduce las cortas. Cualquier otra cosa se deja igual.
 */
export function rewriteSharedLinkPath(path: string): string {
  const m = SHORT.exec(path.trim());
  if (!m) return path;
  return `/${m[1]!.toLowerCase() === "e" ? "event" : "post"}/${m[2]!.toLowerCase()}`;
}

/**
 * Enlace para compartir fuera de la app (ADR 0083, ADR 0104): corto con el dominio aprobado o, sin él, el esquema
 * propio de la app. NO AI REQUIRED.
 */
export function shareUrl(kind: "event" | "post", id: string, domain: string | null): string {
  return domain ? `https://${domain}/${kind === "event" ? "e" : "p"}/${id}` : `dizaster://${kind}/${id}`;
}
