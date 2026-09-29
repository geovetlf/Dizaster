# ADR 0111 — Retraso de publicación editable desde la app de administración

Estado: aceptada (2026-09-29)

## Decisión
Pantalla `admin-delays` (fila "Retraso de publicación" en Perfil, solo rol admin): lista las categorías
HIGHLY_SENSITIVE del catálogo empaquetado, muestra los minutos efectivos y, si difieren, los del catálogo, y los
cambia con `PUT /v1/admin/categories/:code/publish-delay` (ADR 0109). `parseDelayMinutes` valida 0–1440 en el
teléfono antes de enviar; el servidor vuelve a validar. NO AI REQUIRED.
