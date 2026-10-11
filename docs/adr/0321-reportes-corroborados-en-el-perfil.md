# ADR 0321 — «N reportes corroborados» en el perfil público (D3)

- Estado: Aceptado
- Fecha: 2026-10-11
- Relación con el Blueprint: §5 (perfiles), §6 (verificación); decisión D3 aprobada en ADR 0315; ADR 0068, 0074, 0148
- IA: **NO AI REQUIRED**. Costo: 0. Migración 0110.

## Contexto

El perfil público no mostraba reputación; la reputación solo existía por dentro (`social.profiles.low_trust`, módulo
trust). El propietario aprobó el 2026-10-11 que el perfil pueda mostrar «N reportes corroborados» con estas
condiciones:
- cada persona puede ocultarlo;
- no se muestran puntajes internos ni evidencia privada;
- la corroboración comunitaria se distingue de la confirmación oficial;
- el recuento es verificable, consistente y resistente a duplicados y manipulación.

## Decisión

**Qué se cuenta.** `ProfileView.corroboratedReports = { total, official }`. Es el número de **eventos distintos** en
los que la persona tiene un reporte que cumple todo esto:
- reporte con nombre: nunca seudónimo, porque el perfil no puede delatar un reporte seudónimo;
- aceptado (no rebajado a post ni retirado), que afirma el hecho;
- con presencia ALTA o MEDIA: sumarse desde lejos a un evento ajeno no cuenta;
- su evidencia sigue activa en el evento: retirada u oculta por moderación no cuenta (decisión del 2026-09-29);
- el evento está hoy corroborado (comunitaria, externa u oficialmente), publicado, sin disputa ni falsedad, y no
  fusionado en otro.

**Duplicados y manipulación.**
- Varios reportes del mismo evento suman uno.
- La corroboración de un evento ya exige personas y teléfonos independientes, y descuenta textos copiados y cuentas
  nuevas (ADR 0068, 0074).
- El recuento se calcula al leer el perfil, sobre el estado actual. Si un evento pasa a disputa o falso, deja de
  contar en el acto. No hay un contador guardado que se pueda inflar.

**Comunidad frente a oficial.**
- `total` incluye todo lo corroborado.
- `official` es la parte con confirmación de una fuente oficial registrada.
- La app muestra «12 reportes corroborados · 3 con confirmación oficial». Nunca presenta la corroboración comunitaria
  como oficial.

**Ocultarlo.**
- `social.profiles.show_corroborated_reports` (migración 0110). Visible por defecto, como aprobó el propietario.
- Se cambia en «Editar perfil» (`PATCH /v1/me` con `showCorroboratedReports`).
- Oculto, `corroboratedReports` es `null` para todos, incluida la propia persona en su perfil público.

**Qué no se muestra.** Ningún puntaje (presencia, confianza, `low_trust`), ninguna banda de presencia y ninguna
evidencia.

## Pruebas

`test/corroborated-reports.test.ts`:
- eventos distintos y que un evento sin corroborar no suma;
- sin puntajes;
- que el seudónimo no suma;
- que la presencia baja no suma;
- la parte oficial aparte;
- que disputa y moderación quitan del recuento;
- ocultarlo.

En la app, `test/corroborated-line.test.ts`.

## Consecuencias

- Leer un perfil cuesta dos consultas más, ambas por índice (lo comprueba `test/volume-session-plans.test.ts`):
  - los reportes de la persona;
  - una búsqueda por clave de la evidencia y el evento de cada uno.

  Con decenas de miles de reportes por persona convendría guardar el recuento. Hoy no hace falta: el cupo de
  reportes por hora lo limita.
- Una persona con muchos reportes con nombre puede ver que su número baja si un evento se disputa. Es lo esperado.
