# ADR 0330 — Revisión de node-forge y braces (2026-10-11): la excepción sigue igual

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §20 (gates de seguridad); ADR 0070, 0304
- IA: **NO AI REQUIRED**. Costo: 0. Sin cambios de dependencias.

## Contexto

ADR 0304 aceptó hasta el 2026-11-07 dos avisos HIGH sin versión corregida. La auditoría de seguridad del 2026-10-11
los volvió a revisar.

## Estado comprobado

| Paquete | Aviso | Instalada | Última en npm | Ruta (`pnpm audit`) |
| --- | --- | --- | --- | --- |
| `node-forge` | GHSA-86w9-cpqp-85rv / CVE-2026-85393 | 1.4.0 | 1.4.0 (2026-03-24) | `apps__mobile>expo>@expo/cli>node-forge` |
| `braces` | GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 | 3.0.3 | 3.0.3 (2024-05-21) | `apps__mobile>expo>@expo/cli>@expo/metro-file-map>micromatch>braces` |

- `pnpm audit` da `patched_versions: <0.0.0` en los dos: no hay versión corregida.
- `pnpm why` encuentra una sola versión de cada uno. node-forge también llega por `@expo/code-signing-certificates`,
  que cuelga del mismo `@expo/cli`; la ruta auditada sigue siendo la única.
- `pnpm supply-chain`: licencias OK; `{"high":2}`, los dos dentro de la excepción; ningún otro aviso.
- Trivy y OSV-Scanner no están instalados en este entorno; corren en CI con los mismos archivos.

## Decisión

- No hay arreglo compatible. `security/audit-allowlist.json`, `.trivyignore` y `osv-scanner.toml` quedan intactos, con
  el mismo vencimiento (`reviewBy` 2026-11-06; `exp` e `ignoreUntil` 2026-11-07). No se amplía nada.
- Antes del 2026-11-07 hay que revisarlo otra vez con el propietario (ADR 0304).
