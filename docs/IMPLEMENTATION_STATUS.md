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
| Fuente oficial solo confirma dentro de su ámbito; PTWC registrado (D-PTWC) | ✅ | ADR 0060 |
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

A. ✅ PTWC como fuente OFICIAL solo para tsunami (D-PTWC, ADR 0060; feed en PLANNED hasta validar formato).
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

Revisión del Blueprint del 2026-09-29 (tras ADR 0092), verificada contra el código, sin bloqueos:

1. Preparación para idiomas RTL (§5.15).


Bloqueadas o en espera:

- **BLOQUEADA** — Identity real: Sign in with Apple, Google y email; App Attest / Play Integrity. Falta: cuentas de
  Apple Developer y Google (client IDs, Service ID, Team ID) y un proveedor de email aprobado (gasto).
- **BLOQUEADA** — Detección automática de rostros que proponga recuadros (ADR 0042): la opción barata es en el
  teléfono (ML Kit), pero sin `EXPO_TOKEN` no se puede probar un módulo nativo nuevo en una development build.
- **BLOQUEADA** — Publicar el mapa propio: `infra/maps/publish.sh --apply` cuando haya bucket; después validar en un
  teléfono la descarga offline con `pmtiles://` (ADR 0041).
- **En espera de acción humana** — Activar EMSC (ADR 0080): confirmar que sus términos permiten el uso en la app.
- **En espera de acción humana** — Activar ReliefWeb y OMS DON (ADR 0092): ReliefWeb pide registrar un `appname`
  y aceptar sus términos; la OMS, confirmar los términos de uso del sitio. Noticias RSS: falta elegir qué medios
  (decisión de producto y de derechos).
- **En espera de decisión de producto** — Minutos de retraso de publicación para `crime.violence` (ADR 0099): hoy 0,
  sin efecto hasta que se elija un valor.
- **En espera de acción humana** — Fuentes IGP, INDECI y SENAMHI (confirmar formato/URL y términos; si publican CAP,
  activar es solo configuración, ADR 0033).
- **Requiere al propietario** — Capa de IA (proveedor y presupuesto), enlaces de donación verificados (D-15), textos
  legales (términos, privacidad, aviso "no es un servicio de emergencias", edad), detección de CSAM (proveedor y
  procedimiento legal), Sentry (cuenta gratuita y DSN), procedimiento de solicitudes legales.

## Requiere acción humana

| Qué | Por qué no lo puede hacer el agente | Qué hacer |
|---|---|---|
| Repositorio GitHub propio de Dizaster | Las herramientas de esta sesión no permiten crear repositorios | Crear un repositorio vacío (p. ej. `dizaster`) e instalar la app de Claude en él |
| Cuenta cloud, dominio y object storage | Implican gasto y titularidad legal | Aprobar proveedor y presupuesto (Blueprint D-18, D-21). Para media basta un bucket S3 compatible (recomendado: sin egreso) y sus claves |
| Cuenta Expo (gratis) y token `EXPO_TOKEN` | Crear cuentas es personal | Ver `docs/MOBILE_PLATFORMS.md`; con eso el agente compila el APK para tu Android |
| Apple Developer Program (US$99/año) y clave de App Store Connect API | Titularidad, pago y decisión legal (individual u organización) | Ver `docs/MOBILE_PLATFORMS.md` |
| Firebase (FCM, gratis) y Google Play Console (US$25) | Titularidad y pago | Ver `docs/MOBILE_PLATFORMS.md` |
| Credenciales push del servidor: clave APNs `.p8` (+ Team ID, Key ID) y cuenta de servicio de Firebase | Salen de las cuentas de Apple y Google del propietario | Entregarlas como secretos del servidor (`APNS_*`, `FCM_SERVICE_ACCOUNT_JSON`) y poner `PUSH_DRIVER=live` |
| Probar iOS en un iPhone físico antes de publicar | El agente no tiene dispositivos | Un iPhone propio o de un tester de confianza |
| Verificar números de emergencia de Perú | Debe hacerlo una persona contra la fuente oficial | Confirmar 105, 116, 106, 115, 100 y fuentes |
| Clave NASA FIRMS | Registro personal | Solicitar MAP_KEY gratuita cuando se active la fuente |
| Acceso de red a las fuentes (USGS, GDACS) desde el entorno de desarrollo | La política de red de este entorno bloquea esos dominios | Opcional: permitirlos en la configuración de red del entorno para validar los adapters con datos reales |
| Revisión de portugués y francés por hablantes nativos | Calidad de marca y tono; no bloquea el piloto en Perú | Revisar `apps/mobile/src/lib/locales/pt.ts` y `fr.ts` antes de lanzar en países de esos idiomas |
| Revisar términos de uso de GDACS | Decisión legal | Confirmar que el uso previsto está permitido; entonces se activa |
| Revisar la licencia MPL-2.0 de los límites de Perú (juaneladio/peru-geojson, datos INEI) | Decisión legal | Se usan solo en el servidor y se atribuyen; alternativa: límites oficiales de INEI/IGN directamente |
