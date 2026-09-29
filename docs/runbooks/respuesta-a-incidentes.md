# Respuesta a incidentes

## Gravedad
| Nivel | Ejemplos | Respuesta |
|---|---|---|
| SEV-1 | Alertas falsas o que no salen en una emergencia real; exposición de ubicaciones precisas; caída total | Inmediata, todo el equipo |
| SEV-2 | Una fuente oficial caída; verificación o feed atascados; gasto fuera de control | Mismo día |
| SEV-3 | Una función secundaria degradada (vídeo, búsqueda, traducción) | Próximo día hábil |

## Roles
- **Responsable del incidente**: decide y coordina; no arregla.
- **Operación**: ejecuta los runbooks (rol `operator`/`admin` en la app; acceso a la base y a los secretos).
- **Comunicación**: avisa a usuarios e instituciones si el incidente les afecta.

## Primeros 15 minutos
1. Confirmar el síntoma con datos: `GET /health`, registros `ingestion.run` del worker, `platform.outbox` pendiente,
   tablero de costo en la app (ADR 0019, 0110).
2. Contener con los interruptores existentes, sin desplegar código:
   - media: kill switches `media-upload` y `video` (ver presupuesto-y-kill-switches.md);
   - una fuente: `pnpm source-status <clave> PAUSED` (ver fuente-caida.md);
   - una cuenta: suspensión desde moderación (`SUSPEND_USER`) y cierre de sus sesiones.
3. Si hay datos personales expuestos: detener la vía de exposición primero y registrar qué y a quién afectó; la
   notificación legal depende del país y la decide el propietario.

## Cierre
- Volver a encender lo apagado solo con la causa entendida.
- Nota del incidente en `docs/incidents/AAAA-MM-DD-titulo.md` y ADR si cambia una regla o umbral.
