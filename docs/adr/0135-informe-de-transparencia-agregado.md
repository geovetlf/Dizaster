# ADR 0135 — Informe de transparencia agregado

Estado: aceptada (2026-09-29)

## Contexto
§13.3 anticipa un "informe de transparencia futuro". Cada persona ya ve su propia transparencia (`/v1/me/moderation`),
pero no había una vista de conjunto de lo que modera Dizaster.

## Decisión
- `GET /v1/admin/transparency?days=1..366` (solo administración) y `pnpm transparency-report [días]` (JSON). Incluye:
  - denuncias por motivo;
  - casos abiertos, resueltos y descartados, con la mediana de horas hasta cerrarlos;
  - acciones por tipo, autor (regla o persona) y tipo de objeto;
  - reversiones;
  - apelaciones recibidas, confirmadas, revertidas y abiertas.
- Solo conteos, sin personas, objetos ni ids. Las cifras de 1 a 4 se informan como "<5", y la mediana solo con al
  menos 5 cierres, para que el informe se pueda publicar sin señalar casos concretos.
- Sin desglose por país: las acciones de moderación no guardan ubicación, y agregarla solo para esto no se justifica
  todavía. Publicarlo, y con qué frecuencia, es decisión del propietario. NO AI REQUIRED; costo cero.
