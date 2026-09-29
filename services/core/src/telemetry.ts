/**
 * Trazas OpenTelemetry (Blueprint §5.22, ADR 0052). Se carga ANTES que la aplicación:
 *   node --import ./dist/telemetry.js dist/server.js
 * Sin `OTEL_EXPORTER_OTLP_ENDPOINT` no hace nada (cero costo). Con él, envía por OTLP/HTTP a cualquier colector
 * (Grafana Tempo/Alloy autoalojado, capa gratuita de Grafana Cloud…): el proveedor es configuración, no código.
 * Muestreo por defecto 10 % (`OTEL_SAMPLE_RATIO`), respetando la decisión del padre si llega un traceparent.
 */
import { register } from "node:module";

export function sampleRatio(raw: string | undefined): number {
  const n = raw === undefined || raw === "" ? 0.1 : Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.1;
}

export async function startTelemetry(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return false;
  // Módulos ESM: el gancho de import-in-the-middle permite instrumentarlos al importarse.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  const [{ NodeTracerProvider, BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler }, { OTLPTraceExporter }, { resourceFromAttributes }, { registerInstrumentations }, { HttpInstrumentation }, { PgInstrumentation }, { FastifyOtelInstrumentation }] =
    await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/resources"),
      import("@opentelemetry/instrumentation"),
      import("@opentelemetry/instrumentation-http"),
      import("@opentelemetry/instrumentation-pg"),
      import("@fastify/otel"),
    ]);
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      "service.name": env.OTEL_SERVICE_NAME ?? "dizaster-core",
      "service.version": env.npm_package_version ?? "0",
      "deployment.environment.name": env.NODE_ENV ?? "development",
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio(env.OTEL_SAMPLE_RATIO)) }),
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register();
  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Sin cuerpos, cabeceras ni query string: llevan tokens y a veces coordenadas (bbox, lat/lng, búsquedas).
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === "/health",
        requestHook: (span, req) => {
          if (!("headers" in req) || !req.url?.includes("?")) return;
          const path = req.url.split("?")[0]!;
          span.setAttributes({ "url.path": path, "http.target": path, "url.query": "REDACTED" });
        },
      }),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new FastifyOtelInstrumentation({
        registerOnInitialization: true,
        ignorePaths: "/health",
        requestHook: (span, request) => { span.setAttribute("url.path", request.url.split("?")[0]!); },
      }),
    ],
  });
  const stop = () => { void provider.shutdown(); };
  process.once("SIGTERM", stop);
  process.once("beforeExit", stop);
  return true;
}

await startTelemetry();
