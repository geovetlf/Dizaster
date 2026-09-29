# ADR 0002 — Monolito modular con fronteras verificadas en CI

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §4.2, §14, §18

## Contexto
Hay que servir desde pocos usuarios hasta millones sin sobredimensionar la V1 ni reescribir después.

## Decisión
- Un solo servicio (`services/core`) que corre como API o como worker con el mismo artefacto.
- Cada módulo es dueño de un esquema PostgreSQL (`identity`, `social`, `report`, `event`, `verification`, `ingestion`, `media`) sin claves foráneas entre esquemas.
- Un módulo solo importa `../otro/index.js`, y solo consulta su propio esquema. `scripts/check-module-boundaries.mjs` lo verifica en CI.
- Comunicación asíncrona por *transactional outbox* en PostgreSQL con carriles `urgent > interactive > normal > batch` y consumidores idempotentes (`platform.outbox_consumption`). El bus queda detrás de `publish()`/`OutboxDispatcher`.
- Único punto que conoce implementaciones concretas: `src/container.ts`.

## Consecuencias
- Costo fijo mínimo (una base de datos, un proceso API, un worker).
- Extraer un módulo a servicio = mover su esquema y cambiar llamadas en proceso por red; no hay tablas compartidas que desenredar.
- Las llamadas síncronas entre módulos comparten transacción (`Queryable`): consistente hoy; al extraer un servicio se convierten en eventos.
