# ADR 0139 — Registro auditado de requerimientos de autoridades

- Estado: aceptada (2026-09-29, decisión del propietario: "Solo el registro auditado. No implementes todavía ningún
  procedimiento de entrega de datos a autoridades hasta contar con asesoría legal.")
- AI_REQUIRED: no · EXTERNAL_API_REQUIRED: no · COST: ninguno · PRIVACY_IMPACT: bajo (solo identificadores internos)

## Decisión

- `moderation.authority_requests`: autoridad, país, jurisdicción, referencia externa, tipo (entrega, preservación,
  retiro de contenido, emergencia, otro), canal, base legal, recepción, plazo, referencias internas y resumen.
- Referencias solo como identificadores internos (`user:<uuid>`, `post:<uuid>`…). El registro no copia nombres,
  teléfonos ni correos.
- Estados: RECEIVED → IN_LEGAL_REVIEW → ANSWERED | REJECTED | WITHDRAWN. Responder exige pasar por revisión legal;
  los estados finales no se reabren; cada cambio exige una nota.
- Auditoría en la base: el requerimiento no se borra y solo puede cambiar su estado (trigger); el historial
  `authority_request_log` es de solo inserción (ADR 0113).
- Solo el rol admin (con MFA de personal) registra y consulta. Pantalla en la app para Android e iOS.
- El informe de transparencia (ADR 0135) suma los requerimientos recibidos por tipo, con cifras chicas ocultas.

## Fuera de alcance (a propósito)

- NO hay procedimiento, ruta, CLI ni pantalla que entregue o exporte datos de personas a una autoridad. "ANSWERED"
  solo registra que hubo una respuesta, escrita en la nota. Cualquier entrega de datos requiere un ADR nuevo con
  asesoría legal y aprobación del propietario.
