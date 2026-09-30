# ADR 0157 — Aviso push de actualizaciones oficiales

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: un push por evento y ventana (proveedor de push ya previsto)

## Contexto

ADR 0153 permitió a las instituciones publicar actualizaciones oficiales sobre un evento, pero quien lo seguía solo
las veía si abría la app. Es la información que más importa a quien sigue un evento en curso.

## Decisión

- Evento de dominio `OfficialUpdatePosted` (post, evento, nombre público de la institución), publicado por el editor.
- `AlertService.officialUpdate`: tipo de alerta `OFFICIAL_UPDATE` (migración 0072) con el evento y el post. Destinatarios:
  quien sigue el evento y quien ya recibió avisos de él, con sus preferencias (cambios de estado, eventos seguidos,
  silencio, límite por hora). Evento fusionado u oculto: nada.
- Anti-ráfaga: como mucho un aviso por evento cada 30 minutos (`dedup_key` por ventana); las demás actualizaciones
  quedan en el feed del evento.
- Texto: "<Institución> · Actualización oficial" / "Nueva actualización sobre un evento que sigues". Nunca copia el
  texto del post en el push. En la app, el aviso lleva el ícono de megáfono y abre el evento.
