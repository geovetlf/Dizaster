# Estado de la implementación

Actualizado: 2026-09-29

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

**Pruebas:** 70 (contratos 5, geo-kit 24, backend 35 con PostgreSQL real, lógica móvil 6). El empaquetado JS de la app compila para iOS y Android.

## Siguiente etapa (en orden)

1. Media Engine: subida directa con URL firmada, compresión en el dispositivo, miniaturas, captura en la app.
2. Pantalla de pin ajustable dentro del radio permitido y "eventos cercanos: ¿es este?".
3. Adapters de ingestión: USGS (GeoJSON), GDACS (RSS/CAP) y planificador de carriles NORMAL/URGENT.
4. Identity real: Sign in with Apple, Google y email; App Attest / Play Integrity.
5. Social: comentarios, reacciones, seguir, feed cercano.
6. Ciclo de vida de eventos por inactividad; tablero de costo persistido.

## Requiere acción humana

| Qué | Por qué no lo puede hacer el agente | Qué hacer |
|---|---|---|
| Repositorio GitHub propio de Dizaster | Las herramientas de esta sesión no permiten crear repositorios | Crear un repositorio vacío (p. ej. `dizaster`) e instalar la app de Claude en él |
| Cuenta cloud, dominio y object storage | Implican gasto y titularidad legal | Aprobar proveedor y presupuesto (Blueprint D-18, D-21) |
| Cuentas Apple Developer / Google Play | Titularidad y pago | Crear cuentas; aportar Team ID y huella de firma |
| Verificar números de emergencia de Perú | Debe hacerlo una persona contra la fuente oficial | Confirmar 105, 116, 106, 115, 100 y fuentes |
| Clave NASA FIRMS | Registro personal | Solicitar MAP_KEY gratuita cuando se active la fuente |
