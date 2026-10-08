# ADR 0304 — Excepción temporal para node-forge y braces; source-map-js corregido

- Estado: Aceptado por el propietario el 2026-10-08. Vence el 2026-11-07
- Fecha: 2026-10-08
- Relación con el Blueprint: §20 (gates de seguridad); ADR 0070, 0266
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

El 2026-10-08 aparecieron tres avisos HIGH en dependencias transitivas. `supply-chain` (pnpm audit) y `security` (Trivy
y OSV-Scanner) quedaron en rojo, y con ellos `main` y todo PR, porque las reglas de `main` (ADR 0303) exigen esos checks.

| Paquete | Aviso | Corrección publicada | Quién lo trae |
| --- | --- | --- | --- |
| `source-map-js` <1.2.2 | CVE-2026-93749 | 1.2.2 | `postcss` (build de la app) |
| `node-forge` ≤1.4.0 | GHSA-86w9-cpqp-85rv / CVE-2026-85393 | ninguna | `@expo/cli` |
| `braces` ≤3.0.3 | GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 | ninguna | `micromatch` en Metro y Jest |

Ninguno de los tres está en la imagen de la API (`@dizaster/core` no depende de ellos) ni en el bundle de la app:
son herramientas de desarrollo y build de Expo.

## Decisión

- `source-map-js` se corrige con un override a `^1.2.2`.
- `node-forge` y `braces` se aceptan temporalmente, con la aprobación escrita del propietario del 2026-10-08, solo por
  su ID exacto y con vencimiento:
  - `security/audit-allowlist.json`: `reviewBy` 2026-11-06 (el 2026-11-07 `pnpm supply-chain` vuelve a fallar);
  - `.trivyignore`: los dos CVE con `exp:2026-11-07`; CI pasa el archivo a Trivy con `--ignorefile`;
  - `osv-scanner.toml`: los dos GHSA con `ignoreUntil` 2026-11-07.
- Imagen de la API: el escaneo de `image` encontró `perl-base` 5.36.0-7+deb12u3 (CRITICAL/HIGH, corregido en deb12u4)
  y `libpcre2-8-0` deb12u1 (corregido en deb12u2). Se actualiza el digest de `node:22-bookworm-slim` (trae pcre2
  corregido) y la etapa final aplica `apt-get upgrade` para los parches de Debian que la imagen base aún no incluye.
  No es una excepción: se corrigen.
- Ningún check se desactiva y ningún otro aviso queda excluido. Si sale una versión corregida antes, se actualiza y se
  quita la excepción en el mismo PR.

## Consecuencias

- `main` vuelve a verde y los PR pueden fusionarse con los 7 checks.
- El 2026-11-07 los tres escáneres vuelven a fallar si los paquetes siguen sin corregir; entonces se revisa de nuevo
  con el propietario.
- La misma PR arregla una prueba con fecha fija (`verification-explain.test.ts`) que dejó de pasar al envejecer.
