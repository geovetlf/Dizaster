# Estado de la implementación

Actualizado: 2026-09-29 (etapa 4: interfaz y feed)

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

**Pruebas:** 171 (contratos 5, geo-kit 26, backend 103 con PostgreSQL real, móvil 37), más 3 del cliente S3 contra un servidor compatible en CI. JS de la app compila para iOS y Android y los proyectos nativos se generan en CI.

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

## Etapa 3 — Fotos y videos (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Subida directa con URL firmada (S3 compatible y disco local en desarrollo) | ✅ | `services/core/src/modules/media`, ADR 0014 |
| Validación de hash, tamaño y tipo real en el worker | ✅ | `MediaService.process` |
| Eliminación de ubicación en fotos (Exif) y videos (ISO 6709, loci) | ✅ | `media/sanitize.ts` |
| Media en reportes, timeline `MEDIA_ADDED` y galería pública del evento | ✅ | `GET /v1/events/:id/media` |
| Retención de originales y limpieza de subidas abandonadas | ✅ | worker diario |
| App: foto, video y galería con compresión; subida en la cola offline; reenvío automático al volver a la app | ✅ | `apps/mobile/src/lib/media`, `src/lib/report/outbox.ts` |
| Miniaturas, hash perceptual, difuminado de rostros | ⏳ | ADR 0014 (pendiente) |

## Etapa 4 — Interfaz según la referencia y feed social (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Tema oscuro, pestañas y botón central Reportar | ✅ | `apps/mobile/src/app/(tabs)`, `docs/design/REFERENCIA_UI.md` |
| Inicio: cabecera, buscador, categorías, mapa cercano, publicaciones | ✅ | `src/app/(tabs)/index.tsx` |
| Feed: para ti, cerca de ti, videos, filtro por categoría | ✅ | `GET /v1/feed`, ADR 0015 |
| Me gusta y comentarios | ✅ | `/v1/posts/:id/like`, `/v1/posts/:id/comments` |
| Perfil: alertas, reportes pendientes, emergencia | ✅ | `src/app/(tabs)/profile.tsx` |
| Nombres de lugar ("Miraflores, Lima") y búsqueda de lugares | ✅ | Etapa 5 |
| Seguir perfiles y búsqueda de usuarios | ⏳ | siguiente etapa |

## Etapa 5 — Geo Engine: índice geográfico abierto (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Esquema `geo` en PostGIS: áreas administrativas, localidades, datasets con licencia y sha256, memoria por celda H3 | ✅ | `migrations/0006_geo_index.sql`, ADR 0016 |
| Importador de datos abiertos por manifiesto (sin código por país) y CLI `pnpm geo:import` | ✅ | `data/geo/datasets.json`, `modules/geo/importer.ts` |
| Perú: departamento → provincia (ciudad) → distrito con ubigeo INEI; resto del mundo: región Natural Earth + ciudad por cercanía | ✅ | `data/countries/country-config.json` (`geo`) |
| `resolveAdmin` / ubicación contextual del EVENT desde su punto público, con detalle según sensibilidad | ✅ | `GeoService.contextFor`, `event.events.place` |
| Lugar en `EventSummary.place` y `FeedPost.place`; tarjeta "Hace 12 min • Miraflores, Lima" | ✅ | `apps/mobile/src/components/post-card.tsx` |
| Búsqueda de lugares sin geocodificador comercial (`GET /v1/geo/areas`) y mapa encuadrado en el lugar | ✅ | `apps/mobile/src/app/search.tsx`, `(tabs)/map.tsx` |
| Atribución de datasets (`GET /v1/geo/datasets`) | ✅ API · ⏳ pantalla "Acerca de" | |
| 8 distritos de Perú sin polígono en la fuente (p. ej. Santa Anita, La Punta) y nombres sin tildes | ⚠️ | Se muestra la ciudad; ver ADR 0016 |
| Zonas horarias por polígono (países con varias) | ⏳ | timezone-boundary-builder |

## Siguiente etapa (en orden)

1. Seguir perfiles, búsqueda de usuarios y ranking del feed.
2. Identity real: Sign in with Apple, Google y email; App Attest / Play Integrity (necesita cuentas de Apple y Google).
3. Social: comentarios, reacciones, seguir, feed cercano.
4. Tablero de costo persistido y métricas por módulo.

## Requiere acción humana

| Qué | Por qué no lo puede hacer el agente | Qué hacer |
|---|---|---|
| Repositorio GitHub propio de Dizaster | Las herramientas de esta sesión no permiten crear repositorios | Crear un repositorio vacío (p. ej. `dizaster`) e instalar la app de Claude en él |
| Cuenta cloud, dominio y object storage | Implican gasto y titularidad legal | Aprobar proveedor y presupuesto (Blueprint D-18, D-21). Para media basta un bucket S3 compatible (recomendado: sin egreso) y sus claves |
| Cuenta Expo (gratis) y token `EXPO_TOKEN` | Crear cuentas es personal | Ver `docs/MOBILE_PLATFORMS.md`; con eso el agente compila el APK para tu Android |
| Apple Developer Program (US$99/año) y clave de App Store Connect API | Titularidad, pago y decisión legal (individual u organización) | Ver `docs/MOBILE_PLATFORMS.md` |
| Firebase (FCM, gratis) y Google Play Console (US$25) | Titularidad y pago | Ver `docs/MOBILE_PLATFORMS.md` |
| Probar iOS en un iPhone físico antes de publicar | El agente no tiene dispositivos | Un iPhone propio o de un tester de confianza |
| Verificar números de emergencia de Perú | Debe hacerlo una persona contra la fuente oficial | Confirmar 105, 116, 106, 115, 100 y fuentes |
| Clave NASA FIRMS | Registro personal | Solicitar MAP_KEY gratuita cuando se active la fuente |
| Acceso de red a las fuentes (USGS, GDACS) desde el entorno de desarrollo | La política de red de este entorno bloquea esos dominios | Opcional: permitirlos en la configuración de red del entorno para validar los adapters con datos reales |
| Revisar términos de uso de GDACS | Decisión legal | Confirmar que el uso previsto está permitido; entonces se activa |
| Revisar la licencia MPL-2.0 de los límites de Perú (juaneladio/peru-geojson, datos INEI) | Decisión legal | Se usan solo en el servidor y se atribuyen; alternativa: límites oficiales de INEI/IGN directamente |
