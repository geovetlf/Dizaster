import { defineConfig } from "vitest/config";

// Varias pruebas lanzan el CLI en otro proceso (y `dzd agent run` lanza a su vez los gates): con la suite completa en
// paralelo, los 5 s por omisión quedan justos (con Node 26, `dzd agent run` llegó a 5,2 s). El límite es por prueba;
// ninguna se omite.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 } });
