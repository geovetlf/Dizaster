# ADR 0297 — Proveedor `hashicorp/google` 8.x en toda la IaC

- Estado: Aceptado
- Fecha: 2026-10-01
- Relación con el Blueprint: §12 (cost-first), §16 (infraestructura); ADR 0267, 0275
- IA: no. Costo: 0.

## Contexto

Dependabot propuso subir el proveedor de `~> 7.46` a `~> 8.4`, pero en dos PR separados (staging y producción) y sin
tocar `bootstrap`. Fusionarlos por separado dejaría entornos con versiones mayores distintas del mismo proveedor.

## Decisión

1. Staging, producción y `bootstrap` piden `hashicorp/google ~> 8.4` en el mismo cambio; sustituye a los dos PR de
   Dependabot.
2. La prueba es el job `iac` de CI: `tofu fmt`, `tofu init` y `tofu validate` de los tres directorios contra el esquema
   real del proveedor 8.x, y Trivy sobre la IaC.
3. Nada se aplica: no hay recursos creados en Google Cloud. Antes del primer `apply`, el `plan` de cada entorno debe
   revisarse igual que con cualquier otro cambio de IaC.
