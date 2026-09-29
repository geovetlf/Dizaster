# ADR 0044 — Editar mi perfil y unidades

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §5.2, §7.3 (Profile), RF-12

## Contexto
El perfil se creaba con el handle como nombre y no se podía cambiar nada. La columna `units` existía pero nadie la
escribía ni la app la usaba: las distancias salían siempre en km.

## Decisión
- `PATCH /v1/me` cambia nombre visible (1–50), bio pública (hasta 160; vacía = sin bio) y unidades
  (`metric`/`imperial`). `GET /v1/me` devuelve además las unidades, que no son públicas.
- **El handle no se cambia en V1**: rompería menciones, enlaces compartidos y la memoria de quien bloqueó a alguien.
- Sin avatar en V1: evita otro flujo de media con moderación; las iniciales bastan.
- El idioma de la app sigue siendo el del teléfono y el de las alertas su propia preferencia (ADR 0018, 0024); la
  columna `locale` del perfil no se expone.
- La app aplica las unidades a los tramos de distancia del feed y a los radios de zona (millas con un decimal
  por debajo de 10).
- La bio entra en el export de datos, se borra al borrar la cuenta y se modera por la vía de reportar un perfil.
