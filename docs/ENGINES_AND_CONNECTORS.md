# Motores y conectores de Dizaster

Estado al 2026-09-29 (ADR 0064). Principio: **motor determinista primero**. Orden de preferencia para cualquier
capacidad: código propio → datos locales (`data/`) → software libre → PostgreSQL/PostGIS/H3 → AI CORE (opcional) →
conector comercial (solo con presupuesto aprobado).

Resumen de la auditoría: **ninguna función usa IA hoy y ninguna llama a una API comercial de pago.** Todo lo marcado
NO AI REQUIRED funciona sin IA por diseño, no por falta de integración.

## Motores (todos NO AI REQUIRED)

| Motor | Qué hace | Dónde |
|---|---|---|
| DIZASTER ENGINE (reportes y eventos) | Reporte → presencia → EVENT; dedup por categoría, radio H3 y ventana; fusión/separación; ciclo de vida ACTIVE → MONITORING → RESOLVED → ARCHIVED (7 días) | `modules/report`, `modules/event` (ADR 0004, 0014, 0034, 0061) |
| Verificación | Reglas versionadas: UNVERIFIED, COMMUNITY_CORROBORATED, EXTERNALLY_CORROBORATED, OFFICIALLY_CONFIRMED (solo fuente oficial registrada, en su ámbito), DISPUTED, FALSE | `modules/verification` (ADR 0005, 0060) |
| GEOLOCATION ENGINE | País, región y distrito con índice propio (PostGIS), zona horaria por polígonos (geo-tz), generalización pública por sensibilidad | `modules/geo`, `packages/geo-kit` (ADR 0016, 0050) |
| MAP ENGINE | MapLibre + datos abiertos; filtros y estilo por verificación; mapas sin conexión | `apps/mobile/src/lib/map` (ADR 0003, 0041, 0057) |
| EVENT ENGINE (alertas) | Reacciona a EventCreated/EvidenceAdded/VerificationChanged/LifecycleChanged/UserMentioned; horas de silencio, límite por hora, agrupación, dedup | `modules/alert` (ADR 0018, 0063) |
| ALERT ENGINE (push) | APNs y FCM directos (gratis) | `modules/alert/push` |
| I18N ENGINE | Catálogos es/en/pt/fr en la app y textos de aviso en el servidor; un idioma nuevo = un catálogo más | `apps/mobile/src/lib/i18n.ts`, `alert/rules.ts` (ADR 0024) |
| SOURCE CONNECTOR LAYER | Adaptadores USGS, GDACS, CAP 1.2 (incl. PTWC); registro de fuentes con ámbito oficial; breaker y aviso de caída | `modules/ingestion`, `data/source-registry` (ADR 0010, 0033, 0058–0060) |
| EMERGENCY SERVICES REGISTRY | Números por país/subdivisión/servicio/disponibilidad y rutas categoría → servicio; llamada directa | `data/emergency-numbers`, `directEmergencyNumber` (ADR 0009, 0039, 0062) |
| Moderación y confianza | Reglas de spam/duplicado, pHash de fotos recicladas, reputación, límites de uso | `modules/moderation`, `modules/trust`, `media/images.ts` (ADR 0020, 0023, 0025, 0030, 0031, 0047) |
| COST CONTROL | Presupuestos, kill switches, umbrales 50/80/100 %, bloqueo al 100 %, reporte | `modules/cost`, `platform/cost-guard.ts` (ADR 0019, 0026) |
| AI CORE | Único punto de IA, opcional, apagado | `platform/connectors/ai-core.ts` (ADR 0064) |

## Interfaces de proveedores

| Interfaz | Implementaciones hoy | Por defecto | Cómo se activa |
|---|---|---|---|
| `AIProvider` (vía `AiCore`) | `none`, `fixture` | `none` | `AI_PROVIDER`; uno de pago exige `COST_MODE=metered` + presupuesto `ai` |
| `TranslationProvider` | `none` (la app muestra el original) | `none` | `TRANSLATION_PROVIDER` |
| `SmsProvider` | `none`, `log` | `none` | `SMS_PROVIDER` |
| `SpeechToTextProvider` / `TextToSpeechProvider` | `none` (la síntesis de voz del teléfono es gratis) | `none` | `STT_PROVIDER` / `TTS_PROVIDER` |
| `LiveStreamProvider` (LIVE_VIDEO / MEDIA_STREAM / LIVE_EVENT) | ninguna (video grabado sí funciona) | — | ADR 0015 |
| `MapProvider` | MapLibre + estilo configurable | demo | `MAP_*` (ADR 0003) |
| `StorageProvider` | disco local (dev), S3-compatible | local | `STORAGE_DRIVER` |
| `FeedAdapter` (fuentes, clima) | USGS, GDACS, CAP 1.2 | registro | `data/source-registry` |

Modo **costo cero** (`COST_MODE=zero`, por defecto): el servidor no arranca si algún conector es de pago. IA, SMS,
traducción y voz apagados; hay mocks (`fixture`, `log`) para desarrollo.

## Auditoría por función

| FUNCTION | PURPOSE | IMPLEMENTATION | AI_REQUIRED | EXTERNAL_API_REQUIRED | COST | FALLBACK | PROVIDER | PRIVACY_IMPACT |
|---|---|---|---|---|---|---|---|---|
| Enviar reporte | Registrar lo que pasa, con presencia | Reglas de presencia + outbox | NO AI REQUIRED | No | 0 | Cola offline en el teléfono | Propio | Ubicación precisa cifrada (AES-GCM), nunca pública |
| Agrupar en EVENT / duplicados | Un evento por suceso | H3 + radio/ventana por categoría | NO AI REQUIRED (IA opcional futura solo para ambiguos) | No | 0 | Cola de moderación | Propio | Solo ubicación generalizada |
| Verificación | Estado público del evento | Reglas versionadas | NO AI REQUIRED; IA nunca confirma | No | 0 | — | Propio | Explicación sin identidades |
| Confirmación oficial | OFFICIALLY_CONFIRMED | Fuente oficial registrada, en ámbito | NO AI REQUIRED | Feeds abiertos | 0 | Queda EXTERNALLY_CORROBORATED | USGS/GDACS/CAP | Ninguno |
| Contexto geográfico | País/región/distrito | Índice propio PostGIS | NO AI REQUIRED | No | 0 | Solo país | Propio (datos abiertos) | Cálculo en servidor; país en el teléfono |
| Zona horaria | Hora local de avisos | geo-tz (polígonos locales) | NO AI REQUIRED | No | 0 | Zona única del país | OSS | Ninguno |
| Mapa | Ver eventos | MapLibre | NO AI REQUIRED | Teselas (demo hoy) | 0 | Estilo sin conexión | Configurable | Sin ubicación del usuario al proveedor salvo teselas |
| Alertas push | Avisar a quien le importa | Reglas + APNs/FCM directos | NO AI REQUIRED | APNs/FCM | 0 | Historial en la app | Apple/Google | Texto solo con datos públicos |
| Aviso por mención | Saber que te nombraron | Reglas + anti-spam | NO AI REQUIRED | APNs/FCM | 0 | Historial | Apple/Google | Seudónimo no revela autor |
| Llamada de emergencia | Llamar al servicio correcto | Registro de datos | NO AI REQUIRED | No | 0 | Lista de números / 112 | Propio | País calculado en el teléfono |
| Idiomas | es/en/pt/fr | Catálogos | NO AI REQUIRED | No | 0 | es | Propio | Ninguno |
| Traducción de posts | Leer posts en otro idioma | `TranslationProvider` | Opcional | Opcional | 0 hoy | Mostrar original | none | Texto saldría al proveedor (minimizado) |
| Moderación | Spam, abuso, fotos recicladas | Reglas + pHash + personas | NO AI REQUIRED (triaje IA opcional) | No | 0 | Cola humana | Propio | Solo moderadores |
| Imágenes | Variantes, sin metadatos | sharp | NO AI REQUIRED | No | 0 | Original retenido 30 días | OSS | EXIF/GPS eliminados |
| Difuminado de caras/placas | Proteger terceros | Manual en el teléfono | NO AI REQUIRED (automático bloqueado: EXPO_TOKEN) | No | 0 | Manual | Propio | En el teléfono |
| SMS | Avisos sin datos móviles | `SmsProvider` | No | Sí (futuro) | 0 hoy | Push/historial | none | Teléfono enmascarado en logs |
| Voz (STT/TTS) | Accesibilidad | Interfaces | No | Opcional | 0 | Voz del sistema | none | Audio saldría al proveedor |
| Video en vivo | Transmisión | `LiveStreamProvider` | No | Sí (futuro) | 0 hoy | Video grabado | ninguno | — |
| Costos | No gastar sin permiso | CostGuard | NO AI REQUIRED | No | 0 | Función apagada al 100 % | Propio | Ninguno |
| Resumen de evento | Texto breve | AI CORE (opcional) | Opcional | Opcional | 0 hoy | Línea de tiempo | none | Entrada minimizada |
