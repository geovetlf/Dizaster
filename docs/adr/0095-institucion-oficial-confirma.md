# ADR 0095 — Confirmación por perfil institucional oficial

- Estado: aceptada (2026-09-29).
- Blueprint: §10.2 (OFFICIALLY_CONFIRMED), D-04, ADR 0028, ADR 0060
- IA: **NO AI REQUIRED**. Costo: 0.

## Contexto

§10.2 permite dos caminos a OFFICIALLY_CONFIRMED: un ítem de una fuente oficial registrada, o una publicación de
un perfil institucional oficial verificado que lo confirme explícitamente. D-04 dice que una institución actúa
"como fuente OFFICIAL, no como reporte ciudadano". El sello `INSTITUTIONAL_OFFICIAL` existía, pero ninguna regla
lo usaba.

## Decisión

- **Fuente registrada.** Un perfil con el sello pasa a ser una fuente más del registro, con clave
  `institution:<id del negocio>`, tipo y confianza OFFICIAL y adapter `institutional-profile`.
  - Nunca se descarga: el planificador solo corre adapters de feed.
  - Su ámbito (categorías del catálogo y países) lo fija administración con
    `PUT /v1/admin/businesses/:handle/official-scope`. Sin el sello, eso da 409.
- **Declaración explícita.** Quien administra el perfil confirma o desmiente un EVENT con
  `POST /v1/businesses/:handle/official-statements`. Se exige:
  - el sello vigente y un ámbito activo;
  - que el perfil no esté retirado por moderación;
  - que el evento caiga en el ámbito (si no, 403);
  - que el evento esté activo (si se fusionó, se usa el destino).
- **Mismo camino que las fuentes oficiales.** La declaración entra como un ítem de esa fuente, adjunto solo a ese
  evento (`targetEventId`): si no puede adjuntarse, falla todo y nunca cae en otro evento por deduplicación. Así el
  motor de verificación le aplica las mismas reglas que a una fuente oficial:
  - el ámbito de ADR 0060;
  - la monotonía del nivel;
  - el desmentido oficial, que marca FALSE;
  - la explicación con el nombre de la institución y la hora;
  - la lista de fuentes del evento.
- **Una declaración por evento.** Repetir la misma es idempotente. Decir lo contrario da 409: corregirla es cosa de
  moderación, con auditoría.
- **Retiro.** Si el perfil pierde el sello, se borra o se borra la cuenta, la fuente queda RETIRED y sus
  declaraciones dejan de contar como oficiales. El nivel ya alcanzado no baja (monotonía). Volver a dar el sello no
  la reactiva: administración debe fijar el ámbito otra vez.
- **App.** En la ficha del evento, quien administra un perfil institucional ve "Declaración oficial" solo si el
  evento cae en su ámbito. Pide confirmación y avisa que es una sola vez por evento.

## Consecuencias

- La IA sigue sin poder producir OFFICIALLY_CONFIRMED: solo lo hacen una persona de una institución verificada a
  mano por administración, o una fuente oficial registrada.
- Dar el sello y el ámbito desde la app queda en las herramientas de administración (siguiente tarea del backlog).
- Pruebas: `services/core/test/official-institution.test.ts`, `apps/mobile/test/official-statement.test.ts`.
