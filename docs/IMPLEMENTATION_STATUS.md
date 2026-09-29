# Estado de la implementación

Actualizado: 2026-09-29 (etapa 2 + paridad Android/iOS)

## Etapa 1 — Fundación (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Monorepo, lint, typecheck, build, CI | ✅ | `package.json`, `eslint.config.js`, `.github/workflows/ci.yml` |
| Contratos de dominio (POST/REPORT/EVENT, verificación, media preparada para live) | ✅ | `packages/contracts` |
| Geo Engine: H3, presencia física, deduplicación, generalización, país offline | ✅ | `packages/geo-kit` |
| Esquema de datos por módulo (PostGIS + H3), outbox | ✅ | `services/core/migrations/0001_foundation.sql` |
| Report Engine (presencia en servidor, degradación a post, offline, idempotencia, límites) | ✅ | `services/core/src/modules/report` |
| Event Engine (candidato común, deduplicación, geometría agregada, timeline, mapa por clusters) | ✅ | `services/core/src/modules/event` |
| Verification Engine (4 niveles + DISPUTED/FALSE, reglas anti-abuso, IA solo sugiere) | ✅ | `services/core/src/modules/verification` |
| Ingestión: registro de fuentes, entrada común NORMAL/URGENT, idempotencia | ✅ (sin adapters reales) | `services/core/src/modules/ingestion` |
| Identidad: sesiones JWT, dispositivos, login de desarrollo | ✅ parcial | `services/core/src/modules/identity` |
| App móvil: mapa desacoplado, reportar con GPS del sistema, cola offline SQLite, emergencia offline, pantalla de evento, deep links | ✅ | `apps/mobile` |
| Datos: 43 categorías con configuración por país, números de emergencia (pendientes de verificación), fuentes candidatas | ✅ | `data/` |
| Contenedores (API/worker y PostGIS+H3) | ✅ | `infra/docker`, `docker-compose.yml` |

## Etapa 2 — Reporte asistido e ingestión oficial (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Pin ajustable limitado al radio de presencia | ✅ | `packages/geo-kit` (`clampToRadius`), `apps/mobile/src/app/report.tsx` |
| "¿Es este el mismo evento?" (API + app) | ✅ | `GET /v1/events/nearby`, ADR 0012 |
| Adapters USGS (GeoJSON) y GDACS (RSS) | ✅ con archivos de ejemplo | `services/core/src/modules/ingestion/adapters` |
| Planificador NORMAL/URGENT, peticiones condicionales, circuit breaker, registro de ejecuciones | ✅ | `ingestion/scheduler.ts`, migración 0002, ADR 0011 |
| Ciclo de vida por inactividad | ✅ | `EventService.applyLifecycle` (worker, cada hora) |

**Pruebas:** 102 (contratos 5, geo-kit 26, backend 52 con PostgreSQL real, móvil 19 con paridad de plataformas). El empaquetado JS de la app compila para iOS y Android.

## Paridad Android e iOS (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Evaluación del stack móvil; se confirma React Native + Expo | ✅ | ADR 0013 |
| Permisos, textos y manifiesto de privacidad iguales en ambas plataformas | ✅ | `apps/mobile/app.config.ts` |
| Proyectos nativos iOS y Android generados y verificados en CI | ✅ | `pnpm native:check` |
| Builds en la nube sin Mac (perfiles y workflow manual) | ✅ preparado | `apps/mobile/eas.json`, `.github/workflows/mobile-build.yml` |
| Token push nativo APNs / FCM y API de registro | ✅ | `PUT /v1/devices/:id/push-token`, migración 0003 |
| Identidad del dispositivo en Keychain / Keystore | ✅ | `apps/mobile/src/lib/device` |
| Guía de pasos que requieren cuenta Apple / Google | ✅ | `docs/MOBILE_PLATFORMS.md` |

## Siguiente etapa (en orden)

1. Media Engine: subida directa con URL firmada, compresión en el dispositivo, miniaturas, captura en la app (necesita elegir object storage para producción; en desarrollo, almacenamiento local).
2. Identity real: Sign in with Apple, Google y email; App Attest / Play Integrity (necesita cuentas de Apple y Google).
3. Social: comentarios, reacciones, seguir, feed cercano.
4. Tablero de costo persistido y métricas por módulo.

## Requiere acción humana

| Qué | Por qué no lo puede hacer el agente | Qué hacer |
|---|---|---|
| Repositorio GitHub propio de Dizaster | Las herramientas de esta sesión no permiten crear repositorios | Crear un repositorio vacío (p. ej. `dizaster`) e instalar la app de Claude en él |
| Cuenta cloud, dominio y object storage | Implican gasto y titularidad legal | Aprobar proveedor y presupuesto (Blueprint D-18, D-21) |
| Cuenta Expo (gratis) y token `EXPO_TOKEN` | Crear cuentas es personal | Ver `docs/MOBILE_PLATFORMS.md`; con eso el agente compila el APK para tu Android |
| Apple Developer Program (US$99/año) y clave de App Store Connect API | Titularidad, pago y decisión legal (individual u organización) | Ver `docs/MOBILE_PLATFORMS.md` |
| Firebase (FCM, gratis) y Google Play Console (US$25) | Titularidad y pago | Ver `docs/MOBILE_PLATFORMS.md` |
| Probar iOS en un iPhone físico antes de publicar | El agente no tiene dispositivos | Un iPhone propio o de un tester de confianza |
| Verificar números de emergencia de Perú | Debe hacerlo una persona contra la fuente oficial | Confirmar 105, 116, 106, 115, 100 y fuentes |
| Clave NASA FIRMS | Registro personal | Solicitar MAP_KEY gratuita cuando se active la fuente |
| Acceso de red a las fuentes (USGS, GDACS) desde el entorno de desarrollo | La política de red de este entorno bloquea esos dominios | Opcional: permitirlos en la configuración de red del entorno para validar los adapters con datos reales |
| Revisar términos de uso de GDACS | Decisión legal | Confirmar que el uso previsto está permitido; entonces se activa |
