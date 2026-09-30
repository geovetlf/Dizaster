import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Paridad iOS/Android de enlaces compartidos (ADR 0253): cada ruta que Android abre con App Links
// también debe estar en apple-app-site-association.
const root = join(__dirname, "..", "..", "..");
const config = readFileSync(join(__dirname, "..", "app.config.ts"), "utf8");
const aasa = JSON.parse(readFileSync(join(root, "infra/link-domain/.well-known/apple-app-site-association"), "utf8")) as {
  applinks: { details: { components: { "/": string }[] }[] };
};

describe("enlaces universales", () => {
  it("iOS acepta las mismas rutas que Android", () => {
    const android = [...config.matchAll(/pathPrefix: "([^"]+)"/g)].map((m) => `${m[1]}*`).sort();
    const ios = aasa.applinks.details.flatMap((d) => d.components.map((c) => c["/"])).sort();
    expect(android.length).toBeGreaterThan(0);
    expect(ios).toEqual(android);
  });
});
