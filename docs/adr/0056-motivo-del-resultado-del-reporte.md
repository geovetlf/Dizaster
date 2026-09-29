# ADR 0056 — Explicar por qué un reporte bajó a publicación o se rechazó

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint §8.2

## Decisión
- Cuando la presencia no se confirma (`DOWNGRADED_TO_POST`), la app muestra una línea práctica por cada motivo que
  devuelve el servidor (GPS impreciso → salir a un lugar abierto; ubicación simulada → desactivarla; hora del
  teléfono → hora automática…), en es/en/pt/fr. Los motivos repetidos se muestran una vez; uno desconocido (servidor
  más nuevo) se omite sin romper.
- `REJECTED` lleva ahora un `code` estable (`INVALID_CATEGORY`, `OFFICIAL_ONLY`) que la app traduce; `reason`
  queda como texto de respaldo.
- Los mensajes nunca revelan umbrales exactos ni cómo engañar la validación: dicen qué corregir, no cuánto margen hay.
