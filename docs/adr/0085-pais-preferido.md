# ADR 0085 — País preferido en el perfil

- Estado: aceptada (2026-09-29)
- Blueprint: §5.2 ("idioma/unidades/país preferidos"), ADR 0039, ADR 0044
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

El perfil ya guardaba idioma y unidades, pero no el país preferido, aunque la columna `social.profiles.home_country`
existía desde el inicio. Sin ubicación, la pantalla de emergencia caía en la región de los ajustes del teléfono,
que muchas veces no es el país donde vive la persona (p. ej. teléfono en `en-US` en Lima).

## Decisión

- `MyProfile.country` y `PATCH /v1/me { country }` (ISO 3166-1 alfa-2 o `null`). El servidor solo acepta códigos
  del dataset de fronteras. Es **privado**: no aparece en el perfil público. Se exporta con los datos de la cuenta
  y se borra al eliminarla (ya ocurría con la columna).
- App: el país se elige en "Editar perfil" (buscador sin tildes; primero la región del teléfono como sugerencia)
  y se guarda también en el teléfono (`preferred-country.txt`) para usarse sin red.
- Orden cuando hace falta un país: **ubicación actual (calculada en el teléfono) → país preferido → región del
  sistema** (`chooseCountry`). Se usa en la pantalla de emergencia (que dice de dónde salió el país) y en
  "todo el país" de las alertas por categoría cuando no hay ubicación.
- No cambia qué eventos o alertas se reciben: eso sigue dependiendo de zonas y suscripciones explícitas.

## Consecuencias

- Pruebas: `services/core/test/profile-edit.test.ts`, `apps/mobile/test/country-choice.test.ts`.
