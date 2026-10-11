import { expect } from "vitest";
import { z } from "zod";

/**
 * Versión estricta y profunda de un esquema de respuesta: todo objeto rechaza claves que el contrato no declara. Así
 * una prueba detecta en los dos sentidos un desajuste entre lo que el backend emite y lo que `@dizaster/contracts`
 * publica (un campo de más falla por estricto; uno que falta, por requerido). Las refinaciones de objetos se pierden:
 * para respuestas no importan.
 */
const strictCache = new WeakMap<z.ZodType, z.ZodType>();
export function deepStrict(s: z.ZodType): z.ZodType {
  let out = strictCache.get(s);
  if (!out) strictCache.set(s, (out = build(s)));
  return out;
}

function build(s: z.ZodType): z.ZodType {
  const def = (s as unknown as { _zod: { def: Record<string, unknown> & { type: string } } })._zod.def;
  switch (def.type) {
    case "object": {
      // Un objeto declarado abierto a propósito (catchall/passthrough) se respeta.
      if (def["catchall"] && (def["catchall"] as { _zod: { def: { type: string } } })._zod.def.type !== "never") return s;
      const shape = def["shape"] as Record<string, z.ZodType>;
      return z.strictObject(Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, deepStrict(v)])));
    }
    case "array":
      return z.array(deepStrict(def["element"] as z.ZodType));
    case "optional":
      return deepStrict(def["innerType"] as z.ZodType).optional();
    case "nullable":
      return deepStrict(def["innerType"] as z.ZodType).nullable();
    case "default":
      return deepStrict(def["innerType"] as z.ZodType).default(def["defaultValue"] as never);
    case "union":
      return z.union((def["options"] as z.ZodType[]).map(deepStrict) as [z.ZodType, z.ZodType, ...z.ZodType[]]);
    case "lazy":
      // Esquemas recursivos (un post SHARE trae el original): se resuelve al validar, con la caché cortando el ciclo.
      return z.lazy(() => deepStrict((def["getter"] as () => z.ZodType)()));
    case "record":
      // `clone` conserva la clave tal cual (p. ej. un partialRecord no exige todas las claves del enum).
      return (s as unknown as { clone(d: object): z.ZodType }).clone({ ...def, valueType: deepStrict(def["valueType"] as z.ZodType) });
    default:
      return s;
  }
}

/** Valida una respuesta real contra su contrato en modo estricto; el mensaje dice la ruta y los caminos que fallan. */
export function expectContract(schema: z.ZodType, body: unknown, label: string): void {
  const r = deepStrict(schema).safeParse(body);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}${"keys" in i ? ` ${JSON.stringify(i.keys)}` : ""}`);
    expect.fail(`${label} no cumple su contrato:\n  ${issues.slice(0, 20).join("\n  ")}`);
  }
}
