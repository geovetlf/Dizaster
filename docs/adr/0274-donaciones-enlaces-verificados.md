# ADR 0274 — Donaciones V1: enlaces externos a organizaciones verificadas

- Estado: Aceptado (código). Cargar organizaciones: BLOCKED_BY_OWNER (verificación de cada una)
- Fecha: 2026-09-30
- Relación con el Blueprint: RF-16, §5.17 Donation Layer, C-10, D-15 (aprobada en ADR 0001: enlaces externos a
  organizaciones verificadas, sin manejar dinero)
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

La auditoría del 2026-09-30 encontró que D-15 estaba aprobada pero no tenía código, contrato ni fila en el estado.

## Decisión

- Contrato `donation.ts`: `DonationOrganization` exige `https`, países, categorías (vacío = todas; un padre cubre a sus
  hijas) y una verificación registrada (`by`, `at`, `evidence`); sin ella el directorio no carga.
  `DONATIONS_HANDLE_MONEY = false`. `donationLinksFor` devuelve como mucho 3 enlaces del país y la categoría del
  evento, en orden alfabético estable (nadie paga por salir primero); sin país conocido, ninguno.
- Datos versionados en `data/donations/organizations.json`, **vacío**: el propietario verifica y carga cada
  organización. El backend valida que sus categorías existan.
- `GET /v1/events/:id/donations` (público, caché 5 min) → `{ organizations: [{ id, name, url }] }`.
- App: sección "Cómo ayudar" en la ficha del evento solo si hay organizaciones; cada enlace se abre fuera de la app
  con `Linking.openURL` y una nota dice que Dizaster no recibe ni gestiona dinero. Igual en iOS y Android.

## Consecuencias

- Mientras el directorio esté vacío, nada cambia para las personas.
- Donaciones integradas (proveedor de pagos) siguen siendo una extensión futura: regulación y reglas de cada tienda.
