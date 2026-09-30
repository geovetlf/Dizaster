# Runbooks de operación de Dizaster

Procedimientos para incidentes y tareas de operación (Blueprint §13.1 "plan de respuesta a incidentes", §18).
Cada runbook dice cómo detectarlo, qué hacer primero para proteger a las personas y cómo volver a la normalidad.
Ninguno exige IA ni servicios de pago. Donde falta infraestructura real (proveedor, bucket, alertas), se indica.

| Situación | Runbook |
|---|---|
| Cualquier incidente: gravedad, roles, comunicación | [respuesta-a-incidentes.md](respuesta-a-incidentes.md) |
| Una fuente oficial o urgente deja de responder o publica basura | [fuente-caida.md](fuente-caida.md) |
| Gasto disparado, presupuesto agotado o abuso de subidas | [presupuesto-y-kill-switches.md](presupuesto-y-kill-switches.md) |
| Eventos de dominio atascados (alertas o verificación no avanzan) | [outbox-atascado.md](outbox-atascado.md) |
| Respaldo, restauración y prueba de restauración | [respaldo-y-restauracion.md](respaldo-y-restauracion.md) |
| Migración fallida o incompatible (rollback de base de datos) | [migracion-fallida.md](migracion-fallida.md) |
| Activar cada bloqueo externo (GitHub, Expo, Google Cloud, base, media, correo, atestación, CSAM, push, fuentes) | [activacion-bloqueos.md](activacion-bloqueos.md) |
| Delivery Control Plane: gates, despliegue, rollback, auditoría | [delivery-plane.md](delivery-plane.md) |
| Rotar la clave de cifrado de columnas o el secreto de sesión | [rotacion-de-claves.md](rotacion-de-claves.md) |
| Reutilización de tokens de sesión o cuenta comprometida | [sesiones-comprometidas.md](sesiones-comprometidas.md) |

Reglas comunes:
- Primero la seguridad de las personas (alertas correctas, ubicación precisa protegida), después la disponibilidad,
  después el costo.
- Nada destructivo sin dos personas: no se borran bases, buckets ni registros de auditoría (son de solo inserción,
  ADR 0113).
- Todo incidente deja una nota: qué pasó, a quién afectó, qué se hizo y qué cambia (ADR si cambia una regla).
