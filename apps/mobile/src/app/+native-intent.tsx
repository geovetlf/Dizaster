import { rewriteSharedLinkPath } from "../lib/links";

/** Enlaces universales / App Links: /e/<id> y /p/<id> a sus pantallas (ADR 0083). Nunca lanza. */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return rewriteSharedLinkPath(path);
  } catch {
    return path;
  }
}
