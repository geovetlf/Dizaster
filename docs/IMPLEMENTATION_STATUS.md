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
| Mencionar/bloquear negocios, varios administradores | ⏳ | siguiente iteración |

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
| Reglas `dedup-2` con `sim_media` y `sim_texto` reales | ✅ | `packages/geo-kit/src/dedup.ts` |
| Fotos procesadas después del reporte suman su hash al evento | ✅ | `MediaReady.phash`, `event.media-fingerprint` |

## Siguiente etapa (en orden)

1. **BLOQUEADA** — Identity real: Sign in with Apple, Google y email; App Attest / Play Integrity. Falta: cuentas de
   Apple Developer y Google (client IDs, Service ID, Team ID) y un proveedor de email aprobado (gasto).
2. Números de emergencia con actualización incremental (`?since=version`, §6.3).
3. Tipos de reacción de contexto ("apoyo", "útil", "yo también lo vi", §7.3).
4. Scripts y estilos de mapas offline por zona guardada (§11.3; el alojamiento requiere storage aprobado).
5. Difuminado de rostros y matrículas (D-08; modelo abierto, trabajo grande).
6. Fuentes peruanas IGP, INDECI y SENAMHI: **en espera de acción humana** (confirmar formato/URL y términos);
   si publican CAP, activar es solo configuración (ADR 0033).

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
