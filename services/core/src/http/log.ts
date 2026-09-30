import type { FastifyRequest } from "fastify";

/**
 * Logs de peticiones sin datos personales (ADR 0204, §13.2, RNF-04). El query string puede llevar la ubicación
 * del lector (`/v1/events/nearby?lat=…&lng=…`, cajas del mapa, `/v1/geo/country`): se registra solo la ruta y
 * se marca que había consulta. La IP y el puerto del cliente no se registran (ADR 0142: sin IP).
 */
export function logPath(url: string): string {
  const q = url.indexOf("?");
  return q < 0 ? url : `${url.slice(0, q)}?[REDACTED]`;
}

export const requestLogSerializers = {
  req: (req: FastifyRequest) => ({ method: req.method, url: logPath(req.url), id: req.id }),
};

export function requestLogOptions(level = "info") {
  return {
    level,
    serializers: requestLogSerializers,
    // Por si alguna vez se registra la petición completa.
    redact: ["req.headers.authorization", "req.headers.cookie", "req.headers[\"x-forwarded-for\"]", "req.remoteAddress", "req.remotePort"],
  };
}
