// Configuración común: los paquetes del monorepo se resuelven desde su código fuente en tests.
export const sourceConditions = { resolve: { conditions: ["source"] }, ssr: { resolve: { conditions: ["source"] } } };
