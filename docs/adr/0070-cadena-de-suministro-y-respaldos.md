# ADR 0070: Cadena de suministro y respaldos verificados

- Estado: aceptada (Blueprint §13.1)
- IA: **NO AI REQUIRED**. API externa: registro npm (auditoría) y GitHub (Dependabot, gratis). Costo: 0.

## Decisión

- **Licencias** (`pnpm supply-chain`): toda dependencia de producción debe tener una licencia permitida
  (`security/license-policy.json`: MIT, ISC, BSD, Apache-2.0, 0BSD, BlueOak, Unlicense, CC0, Python-2.0, CC-BY-4.0,
  MPL-2.0). Expresiones SPDX: `OR` vale con una opción permitida; `AND` necesita todas. Excepción documentada:
  libvips de sharp (LGPL-3.0, enlazada dinámicamente, solo en el servidor). Cualquier otra copyleft fuerte hace fallar
  CI. Aceptar una licencia nueva de ese tipo es decisión del propietario.
- **Avisos de seguridad**: `pnpm audit --prod`; CI falla con avisos high/critical salvo los aceptados en
  `security/audit-allowlist.json` con motivo y fecha de revisión (vencida, vuelve a fallar). Hoy: 0 high/critical;
  2 moderados en herramientas de Expo (uuid, decode-uri-component), que se resuelven con la próxima SDK.
- **SBOM** CycloneDX 1.5 (`pnpm sbom`) generado en cada CI como artefacto.
- **Dependabot**: semanal, agrupado; Expo/React Native se actualizan por SDK completo (`npx expo install --fix`).
- **Respaldos**: `scripts/db-backup.sh` (`pg_dump -Fc` + sha256). `pnpm db:restore-check` restaura en una base
  temporal nueva, compara filas de todas las tablas y borra solo esa base temporal. Corre en CI después de las pruebas;
  verificado en desarrollo (67 tablas).

## Pendiente (propietario)

- Dónde guardar los respaldos (otro proveedor, cifrados) y con qué retención: depende del hosting (D-18, BLOQUEADA).
