// Prueba de carga de solo lectura (ADR 0282). Sin datos de personas, sin sesiones, sin escrituras.
//   k6 run -e BASE_URL=http://127.0.0.1:8088 --summary-export k6-summary.json infra/load/smoke.js
//   pnpm dzd slo --k6 k6-summary.json --smoke
// Los umbrales son los de delivery/policy.json (p95 < 300 ms). La decisión final la toma `dzd slo`, no k6.
/* global __ENV */
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:8080";
// El límite por IP de la API (RATE_LIMIT_PER_MINUTE, 300 por defecto) responde 429 a una sola máquina que genera
// carga: se cuenta aparte y no como fallo. Para medir la API y no el límite, subirlo SOLO en el entorno local.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));
const serverErrors = new Counter("server_errors");
const rateLimited = new Counter("rate_limited");
const PATHS = ["/health", "/v1/config", "/v1/reference/categories", "/v1/events?bbox=-77.2,-12.2,-76.9,-11.9&zoom=10", "/v1/feed"];

export const options = {
  scenarios: {
    lectura: { executor: "constant-arrival-rate", rate: Number(__ENV.RATE || 20), timeUnit: "1s", duration: __ENV.DURATION || "30s", preAllocatedVUs: 10, maxVUs: 50 },
  },
  thresholds: { http_req_duration: ["p(95)<300"], server_errors: ["count<1"] },
};

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)];
  const r = http.get(`${BASE}${path}`, { tags: { name: path.split("?")[0] } });
  if (r.status === 0 || r.status >= 500) serverErrors.add(1);
  if (r.status === 429) rateLimited.add(1);
  check(r, { "sin 5xx": (x) => x.status !== 0 && x.status < 500 });
}
