# ADR 0315 — Expediente de las siete decisiones pendientes

- Estado: **Propuesta. Nada de esto está aprobado por el propietario.** Cada recomendación es solo eso, hasta que
  el propietario responda. Cuando responda, cada decisión tendrá su propio ADR, como pasó con ADR 0314.
- Fecha: 2026-10-10
- Relación con el Blueprint: §2 (C-06, C-07), §5.2, §5.3, §8, §13; ADR 0004, 0063, 0156, 0171, 0314
- IA: **NO AI REQUIRED**. Costo: 0 (solo documentación).

## Para qué sirve

Reúne en un solo sitio lo que el propietario necesita para decidir: qué hace hoy el código, las alternativas, sus
riesgos, la recomendación técnica y qué pasa si no se decide. El comportamiento actual está comprobado en el código
con la fecha de este ADR.

## D1 — Cuánto tiempo se guarda la ubicación precisa en categorías sensibles

**Hoy:** cada reporte guarda cifrada la posición del teléfono (`report.presence_evidence.device_fix_enc`). A los
`PRESENCE_RETENTION_DAYS` días (30 por defecto, ADR 0004) un trabajo diario la borra y deja solo la celda H3 r7. El
plazo es el mismo para todas las categorías. La sensibilidad de la categoría solo cambia el punto público, no el
plazo. Si la persona borra el reporte o su cuenta, la posición precisa se borra en el momento.

| Alternativa | Riesgo |
| --- | --- |
| 7 días en categorías sensibles, configurable por categoría | Moderación tiene una semana para revisar la presencia |
| 24 horas | Menos exposición si hay una fuga, pero una denuncia que llegue tarde ya no se puede verificar |
| 30 días para todo (lo de hoy) | Un mes de posiciones precisas de personas que reportaron violencia o delitos |

**Recomendación técnica:** 7 días en categorías sensibles, configurable por categoría como dato; las demás siguen en
30. **Si no se decide:** se mantienen 30 días para todo. Es el plazo más largo de las opciones.

## D2 — Qué hace la respuesta «No, es otro evento»

**Hoy:** «Sí, es el mismo» cierra la revisión. «No, es otro» solo se guarda (`event.dedup_reviews.reporter_answer`):
la revisión queda abierta y el reporte sigue en el mismo evento.

| Alternativa | Riesgo |
| --- | --- |
| Con presencia ALTA se separa en un evento nuevo; con MEDIA va a la cola de duplicados | Una persona con presencia alta puede crear un evento aparte por error. Se revierte con la fusión de moderación |
| Siempre a la cola de duplicados | Moderación decide todo; más carga en un pico |
| Solo se guarda (lo de hoy) | La respuesta de la persona no cambia nada visible |

**Recomendación técnica:** separar con presencia ALTA y mandar a la cola con presencia MEDIA. **Si no se decide:**
las respuestas se siguen guardando y no se pierden. Cuando se decida, se pueden aplicar a las respuestas anteriores.

## D3 — Qué reputación se ve en el perfil público

**Hoy:** el perfil público (`GET /v1/profiles/:handle`) no muestra reputación. La reputación existe solo por dentro:
pesa los reportes y marca las cuentas de baja confianza.

| Alternativa | Riesgo |
| --- | --- |
| «N reportes corroborados», que la persona puede ocultar | Hay que cuidar que el número no se pueda inflar. Ya existe antiabuso por persona y por teléfono |
| Nada público (lo de hoy) | Quien lee no tiene una señal de confianza sobre quien publica |
| Puntaje completo | Invita a manipularlo y expone el criterio interno del antiabuso |

**Recomendación técnica:** «N reportes corroborados», que la persona puede ocultar. **Si no se decide:** el perfil
sigue sin reputación. Es lo más privado y no bloquea nada.

## Uso sin cuenta

**Hoy:** la app abre «Entrar» una vez por arranque, pero se puede cerrar y seguir en solo lectura (ADR 0171). Mapa,
eventos, perfiles, números de emergencia y categorías funcionan sin sesión. Escribir siempre pide cuenta y edad.

| Alternativa | Riesgo |
| --- | --- |
| Solo lectura sin cuenta (lo de hoy) | Más carga anónima en la API, ya limitada por IP |
| Exigir cuenta para todo | Alguien que abre la app en pleno desastre no ve alertas ni números de emergencia sin registrarse |

**Recomendación técnica:** solo lectura sin cuenta. **Si no se decide:** sigue como hoy.

## Estado de lanzamiento por país

**Hoy:** `launchStatus` existe en `data/countries/country-config.json` (Perú `PILOT`; el resto, `AVAILABLE_READ_ONLY`
por defecto), pero el código no lo aplica. Se aceptan reportes de cualquier país.

| Alternativa | Riesgo |
| --- | --- |
| Aplicarlo: fuera de `PILOT` y `AVAILABLE` no se aceptan reportes; la lectura sigue | Un viajero en otro país no puede reportar |
| No aplicarlo en V1 (lo de hoy) | Se aceptan reportes de países sin números de emergencia verificados, sin moderación local ni revisión legal |

**Recomendación técnica:** aplicarlo tal como se llama cada estado. **Si no se decide:** se aceptan reportes de
cualquier país. Es el riesgo más alto de las siete, porque abre países sin preparar.

## Duración de las suspensiones

**Hoy:** `SUSPEND_USER` no vence. Dura hasta que moderación la levanta con `UNSUSPEND_USER`. Ambas acciones quedan en
el registro y son apelables.

| Alternativa | Riesgo |
| --- | --- |
| Duraciones estándar: 24 horas, 7 días o permanente | Hay que elegir bien la duración. El vencimiento es automático |
| Sin vencimiento (lo de hoy) | Una suspensión corta se vuelve indefinida si nadie se acuerda de levantarla |

**Recomendación técnica:** duraciones estándar. **Si no se decide:** cada suspensión dura hasta que moderación la
levanta.

## Avisos sociales (comentarios en mis posts y respuestas)

**Hoy:** solo hay avisos por mención (ADR 0063), con tope por autor y respetando las horas de silencio. No hay avisos
por comentarios ni por respuestas.

| Alternativa | Riesgo |
| --- | --- |
| En V1, apagados por defecto y con límite diario | Poco uso si nadie los enciende |
| Encendidos por defecto | Compiten con las alertas de emergencia (§5.3, fatiga de avisos) |
| Fuera de V1 (lo de hoy) | Quien publica no sabe que le respondieron hasta abrir la app |

**Recomendación técnica:** en V1, apagados por defecto, con límite diario. **Si no se decide:** solo hay menciones,
como hoy.

## Qué no depende de estas decisiones

El resto del backlog técnico sigue sin esperarlas. Nada de lo que se construya mientras tanto da por tomada ninguna
de estas recomendaciones.
