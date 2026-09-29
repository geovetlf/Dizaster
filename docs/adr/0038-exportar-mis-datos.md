# ADR 0038 — Exportar mis datos

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §13.2, ADR 0023 (borrado de cuenta), ADR 0037

## Contexto
Borrar la cuenta ya existía, pero la persona no podía llevarse una copia de lo que Dizaster guarda de ella
(portabilidad y acceso, exigidos por las leyes de datos personales de Perú y de otros países).

## Decisión
- `GET /v1/me/export` devuelve un JSON `DataExport` (`format: "dizaster-export-1"`, `generatedAt`,
  `sections`). Cada módulo aporta su sección con `exportData(uid)`, solo sobre su propio esquema:
  - `identity`: cuenta, inicios de sesión, dispositivos (solo si tienen push activo, sin token), sesiones.
  - `social`: perfil, negocios, posts (con ids de media y eventos), comentarios, reacciones, seguimientos,
    bloqueos.
  - `reports`: reportes con su pin y la ubicación del dispositivo mientras no se haya generalizado. Son datos
    de la propia persona, así que sí se incluyen.
  - `alerts`: preferencias, suscripciones, zonas, última ubicación y notificaciones.
  - `moderation`: acciones sobre mi contenido, mis apelaciones y los reportes de moderación que envié.
  - `media`: metadatos y URL pública si está publicada; nunca la clave interna de almacenamiento.
- Nunca se exporta: hashes de tokens, datos de otras personas (quién me sigue, quién me reportó),
  desglose del puntaje del reporte ni la reputación de confianza. Revelar las reglas antiabuso permitiría
  sortearlas; esta exclusión queda **abierta a revisión legal**.
- Límite de una exportación por minuto por persona (429), `cache-control: no-store` y descarga como adjunto
  `dizaster-export-AAAA-MM-DD.json`.
- App: "Descargar mis datos" en Perfil. Guarda el archivo en la caché de la app (`expo-file-system`) y abre la
  hoja de compartir del sistema (`expo-sharing`), igual en Android e iOS. Sin hoja disponible, avisa de que
  quedó guardada.

## Consecuencias
- Un módulo nuevo que guarde datos personales debe añadir su sección; la prueba `data-export.test.ts` falla si
  aparece algún secreto conocido en la salida.
- El límite está en memoria: con varias instancias sería por instancia. Suficiente en V1 (una instancia).
- Sin coste extra: no hay trabajo en segundo plano ni almacenamiento del archivo en el servidor.
