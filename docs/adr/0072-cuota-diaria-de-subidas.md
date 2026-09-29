# ADR 0072 — Cuota diaria de datos subidos según reputación

- Estado: aceptada (2026-09-29)
- Blueprint: §12.2 (control de costos de almacenamiento y ancho de banda), §13.3 (reputación)
- IA: **NO AI REQUIRED**. Costo adicional: 0 (una suma en PostgreSQL al pedir la URL firmada).

## Contexto

El límite por hora (`MEDIA_UPLOADS_PER_HOUR_LIMIT`) cuenta archivos, no bytes: 30 videos de 60 MB por hora son
1,8 GB por hora y cuenta. El almacenamiento y la salida de datos son el costo variable más grande del V1.

## Decisión

- Al pedir una subida (`POST /v1/media/uploads`) se suman los bytes declarados (original + póster) de las subidas
  de la cuenta en las últimas 24 h que no fueron rechazadas ni borradas, más la subida nueva.
- Si supera el tope, responde `429 DAILY_UPLOAD_QUOTA` antes de firmar ninguna URL: el archivo nunca llega al bucket.
- El tope base es `MEDIA_DAILY_UPLOAD_MB` (300 por defecto, mínimo 60) y se ajusta con el mismo nivel de
  reputación que la cuota de reportes (ADR 0023): NEW la mitad, LOW un cuarto, STANDARD y TRUSTED la base.
- El tamaño declarado es fiable porque al completar la subida el servidor compara con el tamaño real y rechaza si
  no coincide (ADR 0014).

## Consecuencias

- Una cuenta nueva o sancionada no puede llenar el bucket; una persona real en una emergencia tiene margen de
  sobra (300 MB ≈ 5 videos de un minuto más decenas de fotos).
- Pruebas: `services/core/test/upload-quota.test.ts` (cuenta nueva, cuenta con antigüedad, rechazadas y ventana de 24 h).
