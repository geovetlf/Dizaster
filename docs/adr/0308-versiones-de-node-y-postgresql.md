# ADR 0308 — Versiones de Node y PostgreSQL alineadas; condiciones para #3 (PostGIS 17) y #41 (Node 25)

- Estado: Aceptado (la migración de versiones queda pendiente de decisión)
- Fecha: 2026-10-10
- Relación con el Blueprint: §16 (D-18, D-23), §20.7; ADR 0070, 0261, 0278
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

Dependabot mantiene abiertos dos PR que cambian una sola pieza de la plataforma:

- **#3**: `postgis/postgis` 16-3.4 → 17-3.5, solo en `infra/docker/db.Dockerfile`.
- **#41**: `node` 22 → 25, solo en `infra/docker/core.Dockerfile`. Reemplaza a #5, que Dependabot cerró.

Datos verificados el 2026-10-10:

| Fuente | Dato |
| --- | --- |
| Calendario oficial de Node (`nodejs/Release`, `schedule.json`) | 22: LTS, en mantenimiento desde 2025-10-21, fin 2027-04-30. 24: LTS, mantenimiento desde 2026-10-20, fin 2028-04-30. **25: fin de soporte 2026-06-01** (versión impar, nunca LTS). 26: LTS desde 2026-10-28, fin 2029-04-30 |
| Extensiones de Cloud SQL para PostgreSQL (documentación de Google Cloud) | PostGIS 3.5.2 para PostgreSQL 16 y 17. **`h3` no figura entre las extensiones admitidas**, y Cloud SQL solo permite instalar las de esa lista |
| Repositorio | `.nvmrc` 22; `engines.node` `>=22.12`; CI instala `postgresql-16`, `postgresql-16-postgis-3` y `postgresql-16-h3`; el módulo `database-cloudsql` fija `POSTGRES_16`; la migración 0001 y los módulos `report`, `event` y `media` usan funciones `h3_*` en SQL |

## Decisión

1. **#41 no se fusiona.** Node 25 ya no tiene soporte. Cuando se migre, el destino es una LTS, 24 o 26, en un PR propio
   que cambie juntos `.nvmrc`, `engines`, las imágenes y el CI, con su ADR. Node 22 tiene soporte hasta 2027-04-30.
   El agente propone la migración a 26 después del 2026-10-28, fecha en que pasa a LTS, y la aplica con el visto bueno
   del propietario.
2. **#3 no se fusiona.** La imagen local y de CI debe tener la misma versión mayor de PostgreSQL que el destino. El
   modo `vm` usa esta misma imagen. Pasar a 17 exige un ADR de migración de datos (`pg_upgrade` o volcado y
   restauración) y la decisión D-23. PostGIS 17-3.5 no aporta nada que Dizaster necesite hoy.
3. **Alineación obligatoria en CI.** `pnpm check:workflows` falla si no coincide la versión mayor de Node entre `.nvmrc`,
   `engines` y `core.Dockerfile`, o la de PostgreSQL entre `db.Dockerfile`, `ci.yml` y `database-cloudsql`. Así, un
   PR que cambie una sola pieza queda en rojo con el motivo exacto, sin cerrarlo y sin excepciones.
4. **Dependabot vigila todas las raíces de OpenTofu.** `infra/tofu/bootstrap` faltaba. `check:workflows` exige que cada
   `main.tf` con `required_providers` figure en `directories`.

## Consecuencias

- **Dato nuevo para D-23.** El modo `cloudsql` no sirve tal como está, porque Cloud SQL no admite `h3`. Las opciones son:
  - `vm`: la misma imagen que hoy, con H3 garantizado. Es el valor por defecto técnico.
  - `cloudsql`: solo si antes se mueven los cálculos H3 a la aplicación. `packages/geo-kit` ya tiene H3, pero hace falta
    un ADR y una migración.
  - `external`.
  Esto cierra el riesgo 2 del informe de preparación: queda verificado, y en contra.
- #3 y #41 siguen abiertos y en rojo, a propósito, hasta que se cumplan sus condiciones.
