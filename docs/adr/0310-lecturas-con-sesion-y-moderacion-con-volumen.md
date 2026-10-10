# ADR 0310 — Lecturas con sesión y de moderación con volumen

- Estado: Aceptado
- Fecha: 2026-10-10
- Relación con el Blueprint: §5.22 (rendimiento), §13 (moderación); ADR 0309 (mismo método), 0156, 0236, 0291
- IA: **NO AI REQUIRED**. Costo: 0 (tres índices; sin servicios nuevos).

## Contexto

ADR 0309 dejó probadas las lecturas públicas. Faltaban las lecturas con sesión y las de moderación. El método es el
mismo: crear filas reales por la API, clonarlas por miles (la mayoría de otras personas) y pedir el plan de cada
SELECT que lanza la petición.

Volumen de la prueba:
- 60 000 avisos, 3000 de la persona que los lee;
- 40 000 reportes, 2000 de quien reporta, cada uno con su presencia, su evidencia y su revisión "¿es el mismo?";
- 20 000 casos de moderación, un tercio abiertos, con 60 000 denuncias, acciones y apelaciones;
- 10 000 eventos, con su cola de duplicados (1 % abiertos) y sus seguimientos.

Se revisaron 16 lecturas: notificaciones, mis reportes, mis avisos de moderación, mi perfil, seguimientos, zonas,
suscripciones, bloqueos, sesiones, cola y detalle de moderación, apelaciones, evento en moderación, cola de
duplicados, registro de acciones y registro de acceso a la presencia.

| Lectura | Problema |
| --- | --- |
| Mis reportes | La pregunta "¿es el mismo evento?" buscaba en `event.dedup_reviews` por `evidence_id`, sin índice |
| Cola y detalle de moderación | Los motivos y notas de cada caso se buscaban en `moderation.flags` por `case_id`, sin índice. En la cola, una vez por caso de la página |
| Registro de acceso a la presencia | Sin filtro, el orden `accessed_at DESC, id DESC` no tenía índice |

Las demás 13 lecturas ya usaban índices, incluidas las notificaciones (`notifications_profile_idx`).

## Decisión

Migración 0106, con tres índices:
- `event.dedup_reviews (evidence_id)`;
- `moderation.flags (case_id, created_at DESC)`;
- `report.presence_access_log (accessed_at DESC, id DESC)`.

No cambian las consultas, los permisos, la privacidad, el orden ni la paginación.

`services/core/test/volume-session-plans.test.ts` mantiene el volumen y falla si alguna de las 16 lecturas recorre
entera una tabla grande. Las herramientas compartidas con ADR 0309 quedan en `test/query-plans.ts`.

## Resultado (misma máquina, mismo volumen, media de 5 peticiones)

| Lectura | Antes | Después |
| --- | --- | --- |
| Cola de moderación | 38,7 ms | 21,3 ms |
| Detalle del caso | 13,7 ms | 3,9 ms |
| Mis reportes | 8,1 ms | 4,8 ms |
| Registro de acceso a la presencia | 3,3 ms | 2,4 ms |
| Resto | 1–20 ms | igual, dentro del ruido |

Sin los índices, la prueba falla en esas cuatro lecturas.

## Consecuencias y límites

- La cola de moderación y las apelaciones siguen armando cada fila de la página con consultas propias: resumen y
  vista previa del objetivo. Ese trabajo está acotado por el tamaño de página (20 casos, 50 apelaciones) y ahora usa
  índices. No se cambió, porque reescribirlo tocaría la vista previa de cada tipo de objetivo, y con 18–21 ms no lo
  justifica.
- La cola de duplicados con muchos pares abiertos frente a pocos eventos recorre los eventos. Ese plan es correcto a
  ese tamaño. Con la proporción real, una cola corta frente a todos los eventos, usa índices.
- Los tiempos son locales. La latencia real se mide en staging (D-18, D-23).
