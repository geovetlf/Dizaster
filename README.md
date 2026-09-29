# Dizaster

Red social mundial geolocalizada de incidentes, desastres, prevención y alertas. **V1: solo app móvil (iOS + Android).**

> Dizaster es un proyecto completamente independiente. No comparte código, repositorios, configuración ni infraestructura con ningún otro proyecto.

- Fundación técnica: [`docs/DIZASTER_MASTER_BLUEPRINT.md`](docs/DIZASTER_MASTER_BLUEPRINT.md) (aprobado 2026-09-29)
- Decisiones: [`docs/adr/`](docs/adr)
- Estado de la implementación: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)

## Estructura

```
apps/mobile          App Expo (React Native): mapa MapLibre, reportar, emergencia offline, eventos
services/core        Backend: monolito modular (API + worker) sobre PostgreSQL + PostGIS + H3
packages/contracts   Contratos de dominio compartidos (zod): POST/REPORT/EVENT, verificación, media, config
packages/geo-kit     Geo Engine compartido: H3, presencia física, deduplicación, generalización, país offline
data/                Datos de referencia versionados: categorías, números de emergencia, países, fuentes
infra/               Contenedores y archivos del dominio técnico de enlaces
docs/                Blueprint, ADRs, estado
```

## Requisitos

Node 22, pnpm 10, PostgreSQL 16 con PostGIS 3 y H3 (o Docker).

## Desarrollo

```bash
pnpm install
docker compose up -d db                 # o PostgreSQL local con postgis + h3
cp services/core/.env.example services/core/.env
pnpm db:migrate                         # con DATABASE_URL exportada
pnpm --filter @dizaster/core dev        # API en :8080
pnpm --filter @dizaster/mobile start    # requiere development build (MapLibre no funciona en Expo Go)
```

## Verificación

```bash
pnpm check    # lint + fronteras de módulos + typecheck + build + tests
```

Los tests de integración usan una base real: `TEST_DATABASE_URL` (por defecto `postgres://dizaster:dizaster@localhost:5432/dizaster_test`).
