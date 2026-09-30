/**
 * Firma de artefactos (Blueprint §20.11, ADR 0277). CI firma cada imagen con cosign "keyless": el certificado lo
 * emite Sigstore a nombre del workflow de GitHub que construyó la imagen, así que no existe ninguna clave privada que
 * guardar, rotar o filtrar. Aquí vive solo lo determinístico: qué identidad se exige y cómo se lee la respuesta de
 * `cosign verify`. El binario cosign se ejecuta fuera (CI o `dzd signature verify`).
 */

export interface SigningPolicy {
  /** Sin firma válida no se despliega. La política no permite apagarlo (ADR 0277). */
  required: true;
  /** Emisor OIDC de los certificados: GitHub Actions. */
  issuer: string;
  /** owner/repo. null mientras el repositorio remoto no exista (D-24): ninguna firma puede verificarse todavía. */
  repository: string | null;
  /** Workflows que pueden firmar (ruta dentro del repositorio). */
  workflows: string[];
  /** Refs desde las que se firma: la rama principal y las etiquetas de versión. */
  refs: string[];
}

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** `refs/tags/v*` → `refs/tags/v.*`; el resto literal. */
const refRe = (ref: string) => ref.split("*").map(escapeRe).join("[0-9A-Za-z._-]*");

/**
 * Identidad exacta del certificado que se acepta: el workflow, en este repositorio, desde una ref permitida. Un fork,
 * otro repositorio u otra rama no pasa aunque su firma sea válida para Sigstore.
 */
export function identityRegexp(p: SigningPolicy): string {
  if (!p.repository) throw new Error("No hay repositorio configurado (signing.repository, D-24): no se puede verificar ninguna firma todavía.");
  const wf = p.workflows.map(escapeRe).join("|");
  const refs = p.refs.map(refRe).join("|");
  return `^https://github\\.com/${escapeRe(p.repository)}/(${wf})@(${refs})$`;
}

export const imageRef = (image: string, digest: string): string => {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`digest inválido: ${digest}`);
  if (image.includes("@") || /:[^/]*$/.test(image.split("/").at(-1) ?? "")) throw new Error("la imagen va sin etiqueta ni digest: el digest se da aparte");
  return `${image}@${digest}`;
};

/** Registro local de pruebas (sin TLS): solo en la propia máquina. */
const localRegistry = (image: string): string[] => (/^(127\.0\.0\.1|localhost)(:\d+)?\//.test(image) ? ["--allow-http-registry"] : []);

/** Argumentos de `cosign verify` para una imagen por digest. Con `key` (solo pruebas locales) no se usa Sigstore. */
export function cosignVerifyArgs(p: SigningPolicy, image: string, digest: string, key?: string): string[] {
  const ref = imageRef(image, digest);
  if (key) return ["verify", "--key", key, "--insecure-ignore-tlog=true", ...localRegistry(image), "--output", "json", ref];
  return ["verify", "--certificate-oidc-issuer", p.issuer, "--certificate-identity-regexp", identityRegexp(p), "--output", "json", ref];
}

/** Atestación de procedencia (SLSA v1) o SBOM (CycloneDX) adjunta a la imagen. */
export function cosignVerifyAttestationArgs(p: SigningPolicy, image: string, digest: string, type: "slsaprovenance1" | "cyclonedx", key?: string): string[] {
  const ref = imageRef(image, digest);
  if (key) return ["verify-attestation", "--type", type, "--key", key, "--insecure-ignore-tlog=true", ...localRegistry(image), "--output", "json", ref];
  return ["verify-attestation", "--type", type, "--certificate-oidc-issuer", p.issuer, "--certificate-identity-regexp", identityRegexp(p), "--output", "json", ref];
}

/**
 * cosign sale con 0 si hay al menos una firma válida; además se comprueba que lo firmado sea exactamente este digest
 * (defensa contra una respuesta de otra imagen o un registro que resuelva distinto).
 */
export function checkVerifyOutput(stdout: string, digest: string): string[] {
  let payloads: unknown;
  try {
    payloads = JSON.parse(stdout.trim().split("\n").find((l) => l.trim().startsWith("[")) ?? "null");
  } catch {
    return ["la salida de cosign no es JSON"];
  }
  if (!Array.isArray(payloads) || payloads.length === 0) return ["cosign no devolvió firmas"];
  const signed = payloads.map((x) => (x as { critical?: { image?: { "docker-manifest-digest"?: string } } }).critical?.image?.["docker-manifest-digest"]);
  if (!signed.includes(digest)) return [`ninguna firma es de ${digest} (firmados: ${signed.filter(Boolean).join(", ") || "—"})`];
  return [];
}

export function validateSigningPolicy(raw: unknown): string[] {
  const s = raw as Partial<SigningPolicy> | undefined;
  const errors: string[] = [];
  if (!s || typeof s !== "object") return ["signing falta"];
  if (s.required !== true) errors.push("signing.required debe ser true: sin firma no se despliega");
  if (s.issuer !== GITHUB_OIDC_ISSUER) errors.push(`signing.issuer debe ser ${GITHUB_OIDC_ISSUER}`);
  if (s.repository !== null && !(typeof s.repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s.repository))) errors.push("signing.repository es owner/repo o null");
  if (!Array.isArray(s.workflows) || s.workflows.length === 0 || s.workflows.some((w) => !/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(w))) errors.push("signing.workflows: rutas .github/workflows/*.yml");
  if (!Array.isArray(s.refs) || s.refs.length === 0 || s.refs.some((r) => !/^refs\/(heads|tags)\//.test(r))) errors.push("signing.refs: refs/heads/… o refs/tags/…");
  if (Array.isArray(s.refs) && s.refs.some((r) => r === "refs/heads/*" || r.startsWith("refs/pull/"))) errors.push("signing.refs no admite ramas arbitrarias ni PR");
  return errors;
}
