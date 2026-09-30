# ADR 0275 — OpenTofu: cuenta de CI propia, respaldos fuera del entorno, vigilancia externa y presupuesto

- Estado: Aceptado (código validado). Aplicar: BLOCKED_BY_OWNER / BLOCKED_BY_BILLING (D-18)
- Fecha: 2026-09-30
- Relación con el Blueprint: §20.17, §20.19, §20.21; ADR 0130, 0138, 0261, 0267
- IA: **NO AI REQUIRED**. Costo: 0 mientras no se aplique.

## Contexto

La auditoría del Delivery Plane encontró diferencias entre ADR 0261 y `infra/tofu`: la cuenta que subía imágenes era
la misma que desplegaba, no existía `dz-backup` ni su bucket, la vigilancia externa de la API (pendiente desde ADR
0130) no estaba en la IaC y no había presupuesto de facturación.

## Decisión

- `dz-ci` (sube imágenes; la toma solo un job de `main` por WIF) separada de `dz-deploy` (despliega; la toma solo el
  entorno de GitHub). `dz-backup` solo crea objetos en el bucket de respaldos: no lee, no reemplaza, no borra.
- Módulo `backups`: bucket con versionado, acceso uniforme, sin acceso público, retención por días (no bloqueada:
  bloquearla es irreversible y la decide el propietario), borrado automático al vencer y `prevent_destroy`. Puede
  vivir en otro proyecto. Los respaldos ya van cifrados con `age` antes de subir (`scripts/db-backup.sh`).
- Módulo `monitoring`: chequeo de disponibilidad externo sobre `/health` cada 5 min y alerta por correo si falla
  10 min, con enlace al runbook y a `dzd rollback`.
- Módulo `budget`: `google_billing_budget` con avisos al 50, 90 y 100 % y al 100 % previsto. Avisa, no corta: el
  corte lo hacen los kill switches del producto (ADR 0138).
- Nuevas variables sin valor por defecto: `backup` (proyecto, ubicación, bucket, días), `alert_email` y `billing`
  (cuenta, moneda, monto mensual). Son decisiones del propietario.
- Validado con `tofu validate` (OpenTofu 1.13.0, proveedor google 7.46.1), Trivy sin HIGH/CRITICAL (un LOW: el
  bucket usa la clave de Google y no una propia) y `dzd iac-check` sin hallazgos.
