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

**Pruebas:** 183 (contratos 5, geo-kit 26, backend 113 con PostgreSQL real, móvil 39), más 3 del cliente S3 contra un servidor compatible en CI. JS de la app compila para iOS y Android y los proyectos nativos se generan en CI.

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
| Seguir perfiles y búsqueda de usuarios | ✅ | Etapa 6 |

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

## Etapa 6 — Seguir y orden del feed (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Seguir personas, eventos y lugares (distrito o región) | ✅ | `social.follows`, `/v1/follows/...`, ADR 0017 |
| Pestaña "Siguiendo" con contenido real, sin exponer posts seudónimos | ✅ | `SocialService.feed` |
| "Para ti" con orden determinista (verificación, severidad, cercanía, autores seguidos) y cursor estable | ✅ | `RANK_BOOST_HOURS` |
| Proyección de señales de eventos vía outbox (sin leer el esquema event) | ✅ | `social.event_signals` |
| Perfil público, búsqueda de personas, "Mi perfil público" | ✅ | `apps/mobile/src/app/u/[handle].tsx`, `search.tsx` |
| Seguir evento y lugar desde la pantalla del evento | ✅ | `apps/mobile/src/app/event/[id].tsx` |
| Seguir negocios y etiquetas | ⏳ | modelo listo (`target_type`) |

## Etapa 7 — Alertas push (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Motor de alertas independiente, reglas puras (evento nuevo corroborado, cambio de estado, severidad, fin) | ✅ | `services/core/src/modules/alert`, ADR 0018 |
| Alertas por evento seguido, lugar seguido, categoría + zona (distrito…país) y cambios de estado | ✅ | `AlertService.recipients` |
| Deduplicación, límite por hora, agrupación y horas de silencio (con excepción oficial grave) | ✅ | `alert.alerts`, `AlertService.flush` |
| Privacidad: el aviso nunca incluye autoría, textos ni coordenadas | ✅ | `alertText`, `test/alerts.test.ts` |
| Preferencias, suscripciones e historial (API) | ✅ | `/v1/me/alert-preferences`, `/v1/me/alert-subscriptions`, `/v1/me/notifications` |
| APNs (HTTP/2, .p8) y FCM HTTP v1 directos detrás de `PushSender`; tokens muertos se borran | ✅ probado con servidores locales | `push/apns.ts`, `push/fcm.ts` |
| App: historial, ajustes, campana con contador, deep link al EVENT, permisos (incluido "bloqueado" → Ajustes) | ✅ iOS y Android | `apps/mobile/src/app/alerts.tsx`, `alert-settings.tsx`, `src/lib/alerts` |
| Envío real a teléfonos | ⏳ | necesita clave APNs y cuenta de servicio de Firebase (ver abajo) |
| Alertas por cercanía a la ubicación actual | ⏳ | decisión de producto (D-16, sin ubicación en segundo plano) |

## Etapa 8 — Costos: presupuestos, kill switches y tablero (hecha)

| Área | Estado | Dónde |
|---|---|---|
| `CostGuard` persistido: presupuestos diarios/mensuales, gasto real, denegación al agotarse | ✅ | `services/core/src/modules/cost`, ADR 0019 |
| Avisos al 50/80/100 % (una vez por periodo) por outbox | ✅ | `BudgetThresholdReached` |
| Kill switches remotos (sin publicar versión) expuestos en `/v1/config` | ✅ | `cost.kill_switches` |
| Uso medido por módulo, volcado en lote cada minuto | ✅ | `platform/metrics.ts`, `cost.usage_daily` |
| Tablero: costo total, por módulo, diario y por 1.000 usuarios activos | ✅ | `GET /v1/admin/cost`, `pnpm cost:report`, pantalla "Costos" (admin) |
| Precios de referencia versionados como datos | ✅ | `data/cost/prices.json` |
| Avisar a administradores por push al cruzar un umbral | ⏳ | hoy va al log del worker |

## Etapa 9 — Moderación y bloqueos (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Denuncias de posts, comentarios, eventos y perfiles; una por persona; límite por hora | ✅ | `services/core/src/modules/moderation`, ADR 0020 |
| Cola con prioridad determinista y límite automático tras 5 denuncias de cuentas establecidas | ✅ | `ModerationService.reprioritize`, `autoLimit` |
| Acciones con motivo obligatorio y registro auditable; suspensión que permite leer y apelar | ✅ | `moderation.actions`, `IdentityService.assertCanWrite` |
| Transparencia y apelaciones revisadas por otra persona | ✅ | `/v1/me/moderation`, `/v1/moderation/appeals` |
| Bloquear personas (requisito de las tiendas) | ✅ | `social.blocks`, `/v1/blocks/:handle` |
| App: denunciar, bloquear, avisos y herramientas de moderación, iOS y Android | ✅ | `apps/mobile/src/app/flag.tsx`, `moderation/`, `my-moderation.tsx` |
| Difuminado de rostros y matrículas (D-08) | ⏳ | etapa de media |

## Etapa 10 — Seguridad de cuenta (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Acceso de 15 min + refresh rotatorio de un solo uso (solo el hash en la base) | ✅ | `identity.sessions`, `IdentityService.refresh`, ADR 0021 |
| Reuso de un refresh rotado → se revoca toda la familia; cerrar sesión | ✅ | `/v1/auth/refresh`, `/v1/auth/logout` |
| Borrar la cuenta desde la app (App Store y Google Play) | ✅ | `DELETE /v1/me`, evento `AccountDeleted` |
| Cada módulo borra o anonimiza lo suyo (perfil, posts, media en el almacenamiento, alertas, presencia generalizada) | ✅ | handlers `AccountDeleted` en social, report, media, alert |
| App: renovación automática (una a la vez), refresh en Keychain/Keystore, pantalla de borrado con confirmación, iOS y Android | ✅ | `apps/mobile/src/lib/auth/refresh.ts`, `session.tsx`, `app/delete-account.tsx` |
| Ver y cerrar sesiones de otros dispositivos | ⏳ | las familias ya existen; falta la pantalla |

## Etapa 11 — Zonas guardadas y "cerca de mí" (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Zonas guardadas (hasta 5, radio 1–50 km, punto reducido a celda H3 r8) | ✅ | `alert.zones`, `/v1/me/zones`, ADR 0022 |
| Última ubicación aproximada al abrir la app (opt-in, celda r7, caduca a las 72 h, sin historial) | ✅ | `alert.last_locations`, `/v1/me/approximate-location` |
| Alertas `SAVED_ZONE` y `NEAR_ME` con preferencias propias | ✅ | `AlertService.recipients`, `rules.ts` |
| App: sección "Mis zonas", pantalla para añadir zona y envío al abrir, iOS y Android | ✅ | `app/alert-settings.tsx`, `app/zone-edit.tsx`, `lib/alerts/notifications.ts` |
| Alertas con ubicación en segundo plano | ⏳ | después (C-17) |

## Etapa 12 — Trust & Safety: reputación y anti-coordinación (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Reputación por persona (antigüedad, aciertos, reportes falsos, sanciones) en 4 niveles, nunca visible | ✅ | `services/core/src/modules/trust`, ADR 0023 |
| Peso al corroborar por reputación ("2 HIGH + reputación alta"), reglas `verification-2` | ✅ | `VerificationService.independentWeight` |
| Grupos de cuentas jóvenes que co-reportan juntas cuentan como una | ✅ | `TrustService.contributionWeights` |
| Cupo de reportes y peso de denuncias según reputación | ✅ | `ReportService`, `ModerationService.flag` |
| Reputación en la visibilidad del feed; textos idénticos | ⏳ | siguiente iteración |

## Etapa 13 — Idiomas iniciales (hecha)

| Área | Estado | Dónde |
|---|---|---|
| App en español, inglés, portugués y francés (claves completas exigidas por TypeScript) | ✅ | `apps/mobile/src/lib/i18n.ts`, `lib/locales/`, ADR 0024 |
| Diálogos de permisos de iOS en los 4 idiomas | ✅ | `app.config.ts` (`locales`), `scripts/check-native.mjs` |
| Categorías y números de emergencia en los 4 idiomas | ✅ | `data/categories`, `data/emergency-numbers` |
| Avisos push en el idioma de cada persona | ✅ | `alert/rules.ts` |
| Revisión nativa de portugués y francés | ⏳ | ver "Requiere acción humana" |

## Etapa 14 — Miniaturas y hash perceptual (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Fotos re-codificadas sin metadatos: versión de pantalla (≤ 1600 px) y miniatura (≤ 400 px) | ✅ | `services/core/src/modules/media/images.ts`, ADR 0025 |
| Hash perceptual (pHash) con búsqueda por bandas indexadas | ✅ | `media.media.phash`, `phash_bands` |
| Foto reciclada de otra persona → caso de moderación con señal de sistema | ✅ | `MediaReuseDetected`, `ModerationService.systemFlag` |
| App: miniaturas en el mosaico del feed | ✅ | `components/post-card.tsx` |
| Póster de video, `sim_media` en deduplicación, difuminado (D-08) | ⏳ | siguientes iteraciones |

## Etapa 15 — Métricas de calidad y avisos a administración (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Tablero de calidad (API, EVENTs, verificación, alertas, ingesta, moderación) con objetivos | ✅ | `services/core/src/modules/quality`, `GET /v1/admin/quality`, ADR 0026 |
| Latencia de la API en histograma por tramos, sin tabla nueva | ✅ | `platform/metrics.ts`, `cost.usage_daily` |
| CLI `pnpm quality:report` | ✅ | `services/core/src/quality-report-cli.ts` |
| App: pantalla de calidad para administración, iOS y Android | ✅ | `apps/mobile/src/app/admin-quality.tsx` |
| Push a administración al cruzar 50/80/100 % de un presupuesto | ✅ | `AlertService.notifyAdmins`, `budgetAlertText` |

## Etapa 16 — Publicar, etiquetas y menciones (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Publicar sin reporte, con mención opcional de un EVENT (D-03), sin ubicación | ✅ | `social/composer.ts`, `POST /v1/posts`, ADR 0027 |
| Etiquetas canónicas, búsqueda, página y seguir etiquetas (feed "Siguiendo") | ✅ | `social.tags`, `/v1/tags`, `/v1/follows/tag/:tag` |
| Menciones a perfiles existentes, respetando bloqueos | ✅ | `social.post_mentions`, `FeedPost.mentions` |
| Borrar un post propio (texto, etiquetas y media) | ✅ | `DELETE /v1/posts/:id`, `MediaService.purgeMedia` |
| App: redactar, `#` y `@` tocables, pantalla de etiqueta, etiquetas en búsqueda, iOS y Android | ✅ | `app/compose.tsx`, `app/tag/[tag].tsx`, `components/rich-text.tsx` |
| Aviso push por mención | ⏳ | decisión de producto (hoy solo se avisa de EVENTs) |

## Etapa 17 — Perfiles de negocio (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Crear, editar y borrar negocios (máx. 3 por persona), handle único y reservado | ✅ | `social/business.ts`, `/v1/businesses`, ADR 0028 |
| Publicar como negocio (nunca seudónimo; nunca reportes, D-04) | ✅ | `PostComposer`, `asBusiness` |
| Seguir negocios, búsqueda y página con sus posts | ✅ | `/v1/follows/business/:handle`, `/v1/businesses?q=` |
| Verificación manual y gratuita por administración, sello en la app | ✅ | `PUT /v1/admin/businesses/:handle/verification` |
| Moderación de negocios (retirar, restaurar, sanciones a quien lo administra) | ✅ | `ModerationService`, objetivo `BUSINESS` |
| App: mis negocios, formulario, página de negocio, "Publicar como", búsqueda, iOS y Android | ✅ | `app/my-businesses.tsx`, `app/business-edit.tsx`, `app/b/[handle].tsx` |
| Mencionar/bloquear negocios | ✅ | ADR 0054 |
| Fuentes visibles en el evento con licencia y enlace (§9.3) | ✅ | ADR 0055, `GET /v1/events/:id/sources` |
| Motivo práctico cuando un reporte baja a publicación o se rechaza (§8.2) | ✅ | ADR 0056, `lib/report/outcome.ts` |
| Filtros del mapa y estilo por verificación (§11.4) | ✅ | ADR 0057 |
| Aviso a administración cuando una fuente urgente cae o vuelve (§9.2) | ✅ | ADR 0058 |
| Cancelación/expiración de la fuente cierran eventos solo de fuentes (§5.7) | ✅ | ADR 0059 |
| Fuente oficial solo confirma dentro de su ámbito; PTWC registrado como EXTERNAL (D-PTWC-2) | ✅ | ADR 0060, ADR 0109 |
| Archivado de eventos resueltos a los 7 días (D-ARCHIVE) | ✅ | ADR 0061 |
| Varios administradores por negocio | ⏳ | cuando haya demanda (`BusinessMember`) |

## Etapa 18 — Sesiones y dispositivos (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Ver sesiones abiertas (sin IP ni ubicación) y cerrar una o todas las demás | ✅ | `IdentityService.sessions/revokeSessions`, `/v1/me/sessions`, ADR 0029 |
| Dispositivo sin sesiones deja de recibir avisos | ✅ | `identity.devices.push_token` |
| App: "Sesiones y dispositivos", iOS y Android | ✅ | `apps/mobile/src/app/sessions.tsx` |

## Etapa 19 — Deduplicación con texto y fotos (hecha)

| Área | Estado | Dónde |
|---|---|---|
| Huella del EVENT: palabras clave y hashes de fotos, acotados | ✅ | `event.events.keywords/media_hashes`, ADR 0030 |
| Spam coordinado: mismo texto de ≥ 3 cuentas en 24 h → cola de moderación | ✅ | `social.posts.text_hash`, ADR 0031 |
| Reputación baja resta 12 h en "Para ti" (proyección `trust.standing` → `profiles.low_trust`) | ✅ | ADR 0031 |
| Póster de video generado en el teléfono (miniatura, hash perceptual, carga al tocar) | ✅ | ADR 0032 |
| Adapter genérico CAP 1.2 (alerta suelta, Atom con alertas, perfil `cap:*`) | ✅ | ADR 0033 |
| Fusionar, revertir y dividir EVENTs desde moderación (API + pantalla) | ✅ | ADR 0034 |
| Contenido sensible: aviso "tocar para ver" y aprobación de media en categorías sensibles | ✅ | ADR 0035 |
| "Aquí no pasa nada" (contra-reporte) y "Por qué este estado" en la pantalla del evento | ✅ | ADR 0036 |
| Retirar un reporte propio (evidencia DETACHED, post y media borrados) | ✅ | ADR 0037 |
| Exportar mis datos (JSON por módulo, hoja de compartir en la app) | ✅ | ADR 0038 |
| Números de emergencia con `?since=version` y país por ajustes del teléfono | ✅ | ADR 0039 |
| Reacciones de contexto (apoyo, útil, yo también lo vi; nunca son evidencia) | ✅ | ADR 0040 |
| Mapa sin conexión por zona guardada + pipeline PMTiles (subida bloqueada por storage) | ✅ | ADR 0041, `infra/maps` |
| Difuminado manual de rostros y matrículas en fotos (aplicado en el servidor) | ✅ | ADR 0042 |
| Feed de un evento en su pantalla (`/v1/events/:id/posts`) | ✅ | ADR 0043 |
| Editar mi perfil (nombre, bio, unidades) y unidades aplicadas en la app | ✅ | ADR 0044 |
| Comentarios con respuestas de un nivel, borrado propio y reacciones | ✅ | ADR 0045 |
| Compartir dentro de la app (`Post.kind = SHARE`) | ✅ | ADR 0046 |
| Límite general de peticiones por cuenta o IP | ✅ | ADR 0047 |
| Ubicación precisa del reportante cifrada por columna (AES-256-GCM, clave fuera de la BD) | ✅ | ADR 0048 |
| Reglas `dedup-2` con `sim_media` y `sim_texto` reales | ✅ | `packages/geo-kit/src/dedup.ts` |
| Fotos procesadas después del reporte suman su hash al evento | ✅ | `MediaReady.phash`, `event.media-fingerprint` |
| Edad mínima de 16 años sin guardar la fecha de nacimiento (D-13) | ✅ | ADR 0049, `POST /v1/me/age` |
| Zona horaria por polígonos de timezone-boundary-builder (§5.5) | ✅ | ADR 0050, `geo/timezone.ts` |
| Pantalla "Acerca de / licencias" con atribuciones ODbL (§11.3) | ✅ | ADR 0051, `GET /v1/about/attributions`, `app/about.tsx` |
| Contrato OpenAPI 3.1 desde los contratos zod y trazas OpenTelemetry opcionales (§4.3, §5.22) | ✅ | ADR 0052, `GET /v1/openapi.json`, `src/telemetry.ts` |
| Moderación cambia el ciclo de vida de un evento, auditado (§5.7) | ✅ | ADR 0053, `POST /v1/moderation/events/:id/status` |
| Duración (≤ 60 s) y tamaño del video leídos del archivo en el servidor | ✅ | ADR 0071, `videoInfo` |
| Cuota diaria de MB subidos por cuenta según reputación | ✅ | ADR 0072 |
| Bonificación de presencia por foto/video capturado en la app (presence-2) | ✅ | ADR 0073 |
| Textos idénticos entre reportes cuentan como un solo corroborador | ✅ | ADR 0074 |
| Crudo de cada fuente en object storage con retención (raw_ref) | ✅ | ADR 0075 |
| Fusión automática de duplicados, cola de posibles duplicados y métricas de reversión | ✅ | ADR 0076 |
| Ítems de fuentes sin coordenadas ubicados por geocódigo exacto (UBIGEO, ISO 3166-2) | ✅ | ADR 0077 |
| Mapa por teselas z/x/y cacheables en CDN, sin sesión | ✅ | ADR 0078 |
| Horas en la zona del evento y plurales correctos en 4 idiomas | ✅ | ADR 0079 |
| Adaptador EMSC (sismos), fuente externa PLANNED hasta revisar términos | ✅ (activación BLOQUEADA: términos) | ADR 0080 |
| Ventana de tiempo coherente al corroborar (verification-3) | ✅ | ADR 0081 |
| Kill switches remotos de video y subidas | ✅ | ADR 0082 |
| Publicación por enlace (GET /v1/posts/:id) y enlaces universales /e/ /p/ | ✅ | ADR 0083 |
| ETag e If-None-Match en recursos cacheables | ✅ | ADR 0084 |
| País preferido en el perfil | ✅ | ADR 0085 |
| Explicación legible completa de verificación | ✅ | ADR 0086 |
| Alertas según el área oficial afectada | ✅ | ADR 0087 |
| Datos personales → cola de moderación | ✅ | ADR 0088 |
| Acceso auditado a evidencia de presencia | ✅ | ADR 0089 |
| MFA TOTP para moderación y administración | ✅ | ADR 0090 |
| Detección local del idioma del contenido | ✅ | ADR 0091 |
| Adapters NORMAL: ReliefWeb, OMS DON y RSS de noticias (PLANNED) | ✅ (activación en espera: términos) | ADR 0092 |
| Redirección de EVENT fusionado y de sus seguidores | ✅ | ADR 0093 |
| "Mis reportes": estado, EVENT, ubicación precisa y retirar | ✅ | ADR 0094 |
| Confirmación y desmentido por perfil institucional oficial, dentro de su ámbito | ✅ | ADR 0095 |
| Disputa, falsedad y cola de duplicados en la app de moderación | ✅ | ADR 0096 |
| "Lo que sigo" y "Bloqueados" en la app | ✅ | ADR 0097 |
| Administración en la app: presupuestos, sello y ámbito institucional, consultas de presencia, quitar MFA | ✅ | ADR 0098 |
| Retraso de publicación configurable en HIGHLY_SENSITIVE (valor en espera: 0) | ✅ | ADR 0099 |
| Promoción NORMAL → URGENT por regla configurable por fuente (OMS con regla) | ✅ | ADR 0100 |
| Roles verificador y operador con tabla de permisos compartida | ✅ | ADR 0101 |
| Preparación RTL: dirección según el idioma de la app, estilos start/end, guardia | ✅ | ADR 0102 |
| Timeline y verificación con la misma visibilidad que la ficha del evento | ✅ | ADR 0103 |
| Corroborar y compartir desde la ficha del evento (ADR 0104) | Hecho | Chip "Yo también lo veo" (ACTIVE/MONITORING) y compartir con `shareUrl`. NO AI REQUIRED |
| Errores del servidor traducidos por código (ADR 0105) | Hecho | `serverErrorMessage`: español usa el mensaje del servidor; otros idiomas traducen el código. NO AI REQUIRED |
| Paginación por cursor de timeline y comentarios (ADR 0106) | Hecho | `ChronoPageQuery` (cursor = id, clave `(at, id)`), compatible sin parámetros; "Ver anteriores" y scroll infinito. NO AI REQUIRED |
| Búsqueda de publicaciones por texto (ADR 0107) | Hecho | `GET /v1/search/posts` con reglas del feed, trigram (migración 0045), sección en Buscar. NO AI REQUIRED |
| Testimonio tardío con menor peso (ADR 0108) | Hecho | presence-3: factor 0,5 y tope bajo HIGH para reportes offline fuera de tolerancia. NO AI REQUIRED |
| PTWC externa; violencia 5 min editable por admin (ADR 0109) | Hecho | Decisiones del propietario 2026-09-29; migración 0046. NO AI REQUIRED |
| Catálogo de capacidades y registro de uso del AI Core (ADR 0110) | Hecho | 10 capacidades opcionales con regla sin IA; `cost.ai_calls` sin contenido (migración 0047); visión/embeddings/emergencias apagados |
| Retraso de publicación editable en la app (ADR 0111) | Hecho | Pantalla admin-delays para categorías HIGHLY_SENSITIVE. NO AI REQUIRED |
| USGS y GDACS como fuentes externas (ADR 0112) | Hecho | Decisión del propietario; solo instituciones autorizadas confirman |
| Auditoría inmutable y cabeceras de seguridad (ADR 0113, 0114) | Hecho | Triggers solo-inserción (migración 0048); HSTS, nosniff, CSP, etc. en toda respuesta. NO AI REQUIRED |
| Negación externa marca DISPUTED (ADR 0115) | Hecho | verification-4: fuente EXTERNAL con NOT_OCCURRING → DISPUTED, nunca FALSE. NO AI REQUIRED |
| Moderación priorizada por verificación (ADR 0116) | Hecho | Peso del estado público × alcance en la prioridad del caso. NO AI REQUIRED |
| Fuentes oficiales y externas por separado (ADR 0117) | Hecho | `officialSourceCount` (migración 0049) y cabecera "reportes · externas · oficiales". NO AI REQUIRED |
| Contadores sociales al escribir (ADR 0118) | Hecho | Triggers mantienen comentarios, compartidos y reacciones por post (migración 0050). NO AI REQUIRED |
| Foto de perfil y logo de negocio (§7.3, RF-02) | Hecho: miniatura saneada, solo media propia procesada, purga de la anterior, REMOVE_AVATAR en moderación; Avatar y AvatarPicker en la app | ADR 0119 |
| Adaptador Copernicus EMS (§9.3) | Hecho: GeoRSS de activaciones de cartografía rápida, EMSR como id, punto o centro del polígono; EXTERNAL y PLANNED | ADR 0120 |
| MediaRejected con consumidores (§6.2) | Hecho: presencia revisada a la baja desde el desglose guardado, evidencia y verificación, línea de tiempo y post | ADR 0121 |
| Mapeo de categorías por fuente como dato (§9.4) | Hecho: categoryMap en el registro para GDACS, ReliefWeb y Copernicus; validado al cargar contra el catálogo y las categorías declaradas | ADR 0122 |
| Ventana de tiempo del mapa (§6.3) | Hecho: window=6h/24h/7d en /v1/events y teselas (cacheable), chip en el mapa | ADR 0123 |
| Ciclo de vida del evento en el feed (§5.3, §6.2) | Hecho: event_signals.lifecycle desde EventLifecycleChanged; resuelto −8 h, archivado −24 h en Para ti | ADR 0124 |
| Categorías secundarias del evento (§7.3) | Hecho: recalculadas desde la evidencia activa; filtro del mapa y búsqueda las usan; línea También en la ficha | ADR 0125 |
| Reglas de exclusión de publicidad (§5.16, D-14) | Hecho: adPlacementDenials en contratos; sin anuncios en V1 (ADS_ENABLED_V1 = false) | ADR 0126 |
| Runbooks de operación e incidentes (§13.1, §18) | Hecho: docs/runbooks (7 procedimientos) y CLI source-status para pausar o reactivar fuentes | ADR 0127 |
| Ingestión por push firmado por fuente (§9.2) | `POST /v1/ingest/:sourceKey/push`, HMAC-SHA256 con secreto por fuente del entorno, ±5 min, mismo adapter que el sondeo, corrida `trigger=PUSH`; ninguna fuente activada | [0128](adr/0128-ingestion-por-push-firmado.md) |
| Firma en el dispositivo de la evidencia offline (§8.1, §8.3, C-04) | Ed25519 en almacén seguro, clave pública registrada por dispositivo, veredicto VALID/INVALID/ABSENT, reglas `presence-4` (offline sin firma = testimonio tardío), la cola fija reloj y `capturedOffline` al enviar | [0129](adr/0129-firma-de-evidencia-en-el-dispositivo.md) |
| Alertas operativas por SLO incumplido y cola atascada (§5.22) | El worker juzga cada 5 min los SLO del día y la antigüedad del outbox (≤ 300 s); push a administración y operación solo al cambiar de estado (`quality.ops_alert_state`) | [0130](adr/0130-alertas-operativas-por-slo.md) |
| Cupos y reputación por teléfono (§5.20, §8.2, §12.2) | Cupo por hora contado por cuenta y por teléfono; teléfono con cuenta suspendida o 3 señales de manipulación en 30 días cuenta como LOW | [0131](adr/0131-cupos-y-reputacion-por-telefono.md) |
| Límites sociales por confianza y tope diario de reportes (§13.3) | Publicaciones/h y comentarios/min según nivel (NEW la mitad, LOW un cuarto); tope diario = 4 × cupo por hora, por cuenta y teléfono | [0132](adr/0132-limites-por-nivel-de-confianza.md) |
| Re-procesar el crudo guardado de las fuentes (§7.3) | `pnpm reprocess-source <clave> [desde] [hasta]`: última versión de cada ítem con la configuración actual, idempotente, corrida `REPROCESS`; GDACS y Copernicus ya no inventan fechas | [0133](adr/0133-reprocesar-el-crudo-de-las-fuentes.md) |
| Tomar casos de moderación (§7.3) | Reserva de 15 min renovable; fuera de la cola ajena, 409 para actuar; vence sola y se suelta al cerrar; la app toma el caso al abrirlo | [0134](adr/0134-tomar-casos-de-moderacion.md) |
| Informe de transparencia agregado (§13.3) | `GET /v1/admin/transparency` y `pnpm transparency-report`: denuncias, casos, acciones, reversiones y apelaciones; solo conteos, 1–4 como "<5" | [0135](adr/0135-informe-de-transparencia-agregado.md) |
| Edición de posts (§7.1) | `PATCH /v1/posts/:id` 24 h, solo STANDARD/SHARE; rehace idioma, etiquetas, menciones y revisión de datos personales; historial solo en el caso de moderación; "editado" en la app | [0136](adr/0136-edicion-de-posts.md) |
| Quién puede mencionarte (§7.3) | `mentionsFrom` EVERYONE/FOLLOWING/NOBODY en mi perfil; una mención no permitida queda como texto, sin enlace ni aviso; sin perfil privado en V1 | [0137](adr/0137-quien-puede-mencionarte.md) |
| 0138 | Degradación automática por costo fuera de IA: presupuesto `infra`, escalera video → fotos nuevas → fuentes no urgentes (100/110/125 %), restaura solo lo automático, aviso a admin/operación | ✅ |
| 0139 | Registro auditado de requerimientos de autoridades: solo registro (estados con nota, historial de solo inserción, referencias internas), pantalla admin, conteo en transparencia; sin entrega de datos | ✅ |
| 0140 | Hora de fin del evento (occurred_end): la fija el trigger de estado o la fuente oficial, se borra al reactivar; "Terminó …" en la ficha | ✅ |
| 0141 | Avisos push de moderación y apelaciones: tipo MODERATION por la cola de avisos, lleva a "mis avisos", nunca nombra a quien denunció | ✅ |
| 0142 | Anti-coordinación trust-2: cuentas jóvenes creadas con ≤ 10 min de diferencia se agrupan con 1 evento en común (antes 2); sin IP | ✅ |
| 0143 | Reportes ocultos o retirados por moderación dejan de contar (evidencia MODERATED); Restaurar los devuelve y el evento recupera su publicación | ✅ |
| 0144 | Área oficial afectada en la ficha (mapa estático) y guardada por evidencia: fusión, reversión y división la recalculan | ✅ |
| 0145 | Lista de hashes de contenido retirado: REMOVE agrega la media, una subida igual queda HELD y va a la cola (nunca se rechaza); RESTORE la quita | ✅ |
| 0146 | Comentarios con 5 denuncias de personas establecidas se ocultan hasta revisión (HIDE por regla, apelable) | ✅ |
| 0147 | Notas de moderación en la línea de tiempo del evento (INTERNAL, solo moderación) y sección en la app | ✅ |
| 0148 | Listas de términos por idioma (data/moderation/terms.json, vacías): coincidencia exacta manda a revisión, nunca oculta | ✅ |
| 0149 | Ítems externos siguen fusiones, reversiones y divisiones; una declaración por institución y evento se mantiene tras fusionar | ✅ |
| 0150 | Prioridad de casos de moderación al día: se recalcula con cambios de verificación y ciclo del evento y en un barrido horario | ✅ |
| 0151 | Informe de transparencia en la app de administración: periodos, desgloses sin sumar los "<5" y texto para compartir | ✅ |
| 0152 | Catálogo de categorías remoto con etag y ajustes por país en la app; misma regla efectiva en servidor y app | ✅ |
| 0153 | Posts de actualización oficial de perfiles institucionales dentro de su ámbito; destacados, no editables y sin efecto en la verificación | ✅ |
| 0154 | Preferencias de alerta por zona guardada: gravedad mínima y categorías por zona, y edición de zonas en la app | ✅ |
| 0155 | Ítems externos en ERROR sin tumbar la corrida, compartidos fuera de la app contados por persona, seguidores al dividir | ✅ |
| 0156 | "¿Es el mismo evento?" tras un adjunto ambiguo: pregunta al enviar y en Mis reportes; Sí confirma, No queda anotado a la espera de D2 | ✅ |
| 0157 | Aviso push de actualizaciones oficiales a quien sigue el evento, con preferencias y como mucho uno cada 30 min por evento | ✅ |
| 0158 | Cola offline sin pérdidas: sin red no gasta intentos, los detenidos se conservan con Reintentar/Descartar, reintento automático con espera creciente | ✅ |
| 0159 | Worker por roles (urgent / normal / maintenance) en bucles separados; ingesta por carril; WORKER_ROLES para escalar por separado | ✅ |
| 0160 | Gravedad del evento desde su evidencia activa (puede bajar) + corrección auditada de moderación | ✅ |
| 0161 | Pantalla de error global con números de emergencia locales + registro local de errores redactado | ✅ |
| 0162 | Salud de fuentes y pausa/reanudación auditada desde la app de administración | ✅ |
| 0163 | Códec de video leído del archivo: H.264/HEVC se publican sin transcodificar, el resto se rechaza; iOS exporta a H.264 | ✅ |
| 0164 | Versión mínima de la app por plataforma en /v1/config; 426 solo al escribir reportes/posts, emergencias nunca bloqueada | ✅ |
| 0165 | Retención diaria de datos operativos: últimas ubicaciones (72 h), historial de avisos (90 d) y outbox procesado (14 d) | ✅ |
| 0166 | Reportes solo con media capturada en la app (D-10); los posts siguen admitiendo galería | ✅ |
| 0167 | Roles de personal: quitar roles, registro de solo inserción, cierre de sesiones y rol vigente comprobado en cada acceso | ✅ |
| 0168 | Moderación ve el original sin difuminar (sin metadatos) con motivo, tope por hora, enlace de 60 s y registro de solo inserción | ✅ |
| 0169 | País para emergencias: ubicación → SIM (Android) → perfil → región del sistema | ✅ |
| 0170 | Inicio de sesión Apple/Google (OIDC propio) y correo con código sin guardar el correo, vinculación de métodos; apagados hasta tener credenciales | ✅ |
| 0171 | Pantalla "Entrar" con correo y código, arranque sin acceso de desarrollo, vincular métodos; emergencias sin cuenta | ✅ |
| 0172 | Correlación de extremo a extremo (`x-request-id`) y actor en cada evento de dominio; los consumidores heredan la correlación | ✅ |
| 0173 | Fallos de la app autoalojados: envío anónimo y redactado, agrupados por huella para operación, retención 30 días | ✅ |
| 0174 | Alertas con origen (oficial/sistema), vencimiento y referencia CAP; lo vencido antes de salir no suena | ✅ |
| 0175 | Ciudad del evento (`city_id`) desde el lugar público: avisos, búsqueda y "Siguiendo" por ciudad | ✅ |
| 0176 | Aceptación versionada de términos y políticas (mecanismo; textos bloqueados): registro de solo inserción, 428 al publicar si falta, pantalla en la app | ✅ |
| 0177 | Reintento de push con error temporal (429, 5xx, red): 3 reintentos en menos de 2 min, luego FAILED | ✅ |
| 0178 | Posts y comentarios idempotentes con id del cliente: un reintento devuelve lo ya creado | ✅ |
| 0179 | Moderación sube la sensibilidad de un evento por su contexto: punto público, lugar y posts de reportes se generalizan más; nunca baja | ✅ |
| 0180 | La reputación del teléfono (cuenta suspendida o manipulación repetida) baja el peso de su evidencia a LOW | ✅ |
| 0181 | Pruebas de captura del medio (qué foto/video y cuánto antes del reporte) en la evidencia de presencia privada; sin ubicación por medio | ✅ |
| 0182 | Particionado mensual preparado (rango por UUIDv7 con la PK actual), probado sobre copias; runbook para activarlo | ✅ |
| Llamada de emergencia sin esperar al GPS (§8.1) | ✅ | ADR 0183: país por última posición/SIM/perfil/región al elegir categoría, fix con límite de 20 s y reintento, Abrir ajustes si falta permiso de ubicación o cámara |
| Decisiones: sin señal de red, aceptaciones mínimas tras borrar, todo público en V1 | ✅ | ADR 0184 (propietario, 2026-09-30); migración 0088 |
| Mapas offline reales (§11.3) | ✅ | ADR 0185: config remota persistida en el teléfono (sin caducidad), una sola petición compartida, mismo estilo oscuro para ver y descargar |
| Canales de notificación Android como iOS (§5.10) | ✅ | ADR 0186: canal propio para oficiales graves (importancia máxima) y canal general, nombres traducidos, FCM channel_id según critical |
| Latido del worker y /health/ready (§5.22, §13.1) | ✅ | ADR 0187: latido por rol e instancia, /health/ready con worker y outbox (503 con códigos), healthchecks de API y worker en imagen y compose |
| Galería del evento con miniaturas (§12.1) | ✅ | ADR 0188: miniatura en la tira y visor a pantalla completa con la variante grande solo al tocar |
| Respaldos cifrados con clave pública y retención (§13.1) | ✅ | ADR 0189: pg_dump por tubería a age (nunca en claro), obligatorio en producción, restore-check con sha256 y descifrado, retención N últimos + semanales |
| Cola offline que se envía sola (§8.3, C-04) | ✅ | ADR 0190: tiempo límite de 30 s, envío al volver la red (expo-network) y tarea en segundo plano (expo-background-task) sin renovar sesión desde segundo plano |
| Borrador de reporte en el teléfono (§5.4) | ✅ | ADR 0191: borrador sin ubicación con guardado automático, retomar/descartar, recuperación de la cámara en Android, limpieza de media huérfana al arrancar |
| Seguimiento breve del GPS al reportar (§8.2) | ✅ | ADR 0192: lecturas cada 5 s hasta 2 min en primer plano, fix afinado hasta 50 m, trayectoria para la regla de movimiento imposible |
| Etiquetas del mapa en tu idioma (§6.1) | ✅ | ADR 0193: estilos por idioma (es/en/pt/fr) sobre las mismas teselas y {lang} en la URL del estilo |
| Decodificación de media aislada (§13.1) | ✅ | ADR 0194: proceso hijo sin entorno ni red, tiempo máximo por archivo, heap acotado, reciclado; un fallo solo rechaza ese archivo |
| Ubicación simulada en iOS (§8.2, paridad) | ✅ | ADR 0195: parche mínimo de expo-location con isSimulatedBySoftware (iOS 15+), prueba que detecta si se pierde al actualizar |
| Números de emergencia de Perú verificados (§5.11, C-06) | ✅ | ADR 0196: 105, 116, 106 y 100 contrastados con PRONATEL y MIMP (gob.pe); 115 sin confirmar; resto de países pendiente |
| Todos los errores del servidor traducidos (§5.15) | ✅ | ADR 0197: 76 códigos mapeados, 13 mensajes nuevos en 4 idiomas y prueba que falla si aparece un código sin traducción |
| Lector de pantalla y anuncios (§11.4) | ✅ | ADR 0198: nombres accesibles en todos los campos y controles clave, anuncios de estado al reportar, reducir movimiento, pruebas que lo exigen |
| Licencias, auditoría, SBOM, Dependabot; respaldo con prueba de restauración en CI | ✅ | ADR 0070, `scripts/supply-chain.mjs`, `scripts/db-restore-check.mjs` |
| Idioma de la app elegible en el perfil (es/en/pt/fr o del teléfono) | ✅ | ADR 0069, `app/language.tsx` |
| Varias cuentas en un teléfono corroboran como una (clave seudónima del teléfono) | ✅ | ADR 0068, migración 0036 |
| Adaptador NASA FIRMS (focos VIIRS/MODIS → incendio forestal) y secretos de fuentes por entorno | ✅ | ADR 0067; activar espera `SOURCE_KEY_FIRMS` (BLOQUEADA: MAP_KEY) |
| Lectura sin conexión de avisos, mapa y eventos abiertos (SQLite local) | ✅ | ADR 0066, `lib/offline/read-cache.ts` |
| Búsqueda de eventos por categoría, lugar (con subdivisiones) y título, sin IA | ✅ | ADR 0065, `GET /v1/search/events` |
| AI CORE opcional + conectores (IA, traducción, SMS, voz) + modo costo cero | ✅ | ADR 0064, `platform/connectors/`, `docs/ENGINES_AND_CONNECTORS.md` |
| Push por @mención (silencio, preferencia, bloqueos, seudónimo, anti-spam, dedup) | ✅ | ADR 0063, `AlertService.mention`, migración 0035 |
| Llamada directa según registro de servicios de emergencia (país/subdivisión/categoría/servicio/disponibilidad), sin IA | ✅ | ADR 0062, `directEmergencyNumber`, `routes` en `emergency-numbers.json` |

## Siguiente etapa (en orden)

Decisiones del propietario del 2026-09-29 (mensaje "Zero/minimum AI cost architecture"), primero:

A. ✅ PTWC como fuente EXTERNAL (D-PTWC-2, ADR 0109, reemplaza D-PTWC): corrobora, no confirma; feed en PLANNED hasta validar formato.
B. ✅ RESOLVED → ARCHIVED a los 7 días, configurable; fuera del mapa, accesible por enlace (D-ARCHIVE, ADR 0061).
C. ✅ "Llamar" marca directo el número de la categoría según el registro de servicios de emergencia; si no hay, lista (D-EMERGENCY-CALL, ADR 0062).
D. ✅ Push por mención con horas de silencio, preferencias, bloqueos y anti-spam (D-MENTION, ADR 0063).
E. ✅ Auditoría de IA y APIs externas (ninguna en uso); AI CORE único, opcional y apagado; interfaces de conectores
   (traducción, SMS, voz; video en vivo ya existía); modo costo cero; tabla por función en
   `docs/ENGINES_AND_CONNECTORS.md` (ADR 0064). Elegir proveedor de IA/SMS/traducción: BLOQUEADA (propietario).

Revisión del Blueprint del 2026-09-29 (tras ADR 0054): completada con ADR 0055–0070. Lo que sigue depende de
decisiones o credenciales del propietario (lista de abajo); mientras tanto se continúa con mejoras sin bloqueo.

Revisión del Blueprint del 2026-09-29 (tras ADR 0070): completada con ADR 0071–0080.

Revisión del Blueprint del 2026-09-29 (tras ADR 0080): completada con ADR 0081–0092.

Revisión del Blueprint del 2026-09-29 (tras ADR 0092): completada con ADR 0093–0102.

Revisión del Blueprint del 2026-09-29 (tras ADR 0102): completada con ADR 0103–0108.

Revisión del Blueprint del 2026-09-29 (tras ADR 0109, mensaje de bajo costo del propietario): completada con ADR 0110–0112.

Revisión del Blueprint del 2026-09-29 (tras ADR 0112): completada con ADR 0113–0120.

Revisión del Blueprint del 2026-09-29 (tras ADR 0148): completada con ADR 0149–0157.

Revisión del Blueprint del 2026-09-30 (tras ADR 0157): completada con ADR 0158–0164.

Revisión del Blueprint del 2026-09-30 (tras ADR 0164): completada con ADR 0165–0171.

Revisión del Blueprint del 2026-09-30 (tras ADR 0171): completada con ADR 0172–0176.

Revisión del Blueprint del 2026-09-30 (tras ADR 0176): completada con ADR 0177–0182.

Revisión del Blueprint del 2026-09-30 (tras ADR 0182): completada con ADR 0183–0189 (0184 aplica las decisiones del
propietario del 2026-09-30: sin señal de red, aceptaciones mínimas tras borrar la cuenta, todo público en V1).

Revisión del Blueprint del 2026-09-30 (tras ADR 0189): completada con ADR 0190–0196 (video 720p en Android queda
BLOQUEADO hasta el primer build de desarrollo).

Revisión del Blueprint del 2026-09-30 (tras ADR 0196), verificada contra el código, sin bloqueos:
1. Contraste AA del texto de error y prueba automática de contraste del tema.
2. Mapa accesible (§11.4, §5.6): lista de eventos visibles y tocar un grupo acerca el mapa.
3. Tiempos límite en base de datos y HTTP (§5.22, §14): fallar rápido con 503 en picos en vez de encolar sin límite.
4. Nombres regionales de categorías en los 4 idiomas y prueba de que todo texto localizado de `data/` los tiene.

Bloqueadas o en espera:

- **BLOQUEADA** — Video 720p también en Android (§12.1, paridad): necesita transcodificar en el teléfono (módulo local con Media3 Transformer, Apache-2.0, sin coste). Es código nativo nuevo que no se puede compilar ni probar aquí (sin SDK de Android); se hace con el primer build de desarrollo (EXPO_TOKEN). Mientras tanto el límite de 60 MB acota el coste.
- **EN ESPERA** — D1: días de retención de la ubicación precisa en categorías sensibles (§2 C-07).
- **EN ESPERA** — D3: qué se muestra de la reputación en el perfil público (§5.2 vs §13.3).
- **PENDING DECISION** — D2 (parte de ADR 0156): la respuesta "No, es otro" se guarda en `event.dedup_reviews.reporter_answer`; falta decidir si divide el evento, va a la cola de duplicados u otra cosa. Nada se mueve hasta entonces.
- **PENDING DECISION** — Estado de lanzamiento por país (C-06, D-02): `launchStatus` (PILOT, AVAILABLE, AVAILABLE_READ_ONLY, RESTRICTED) existe en los datos pero no se aplica; falta decidir qué pasa con los reportes ciudadanos fuera de PILOT/AVAILABLE.
- **PENDING DECISION** — Duración de suspensiones: hoy `SUSPEND_USER` no vence; falta decidir si hay duraciones estándar (24 h / 7 d / permanente).
- **PENDING DECISION** — D-17 fronteras en disputa: sin implementar; falta criterio del propietario (y revisión legal antes de abrir más países).
- **PENDING DECISION** — Uso sin cuenta (ADR 0171): hoy se puede cerrar "Entrar" y seguir en solo lectura; falta decidir si V1 lo permite o exige cuenta.
- **BLOQUEADA** — Contacto del cliente de ingesta (§9.3): el User-Agent dice "contacto pendiente"; falta el correo o URL de contacto del propietario.
