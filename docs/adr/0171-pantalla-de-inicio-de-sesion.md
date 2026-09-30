# ADR 0171 — Pantalla de inicio de sesión en la app

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

ADR 0170 dejó listo el servidor (Apple, Google, correo con código). La app solo conocía el acceso de desarrollo,
que el servidor no ofrece en producción: una build de producción no podía entrar.

## Decisión

- Arranque (`startupPlan`): con refresh guardado se renueva; sin él, el acceso de desarrollo si el servidor lo tiene
  (404 = no lo tiene); si no, `needsSignIn` y se abre "Entrar". Una cuenta real (`method: REAL` en el almacén seguro)
  nunca vuelve a entrar sola: si su refresh vence o se revoca, se pide iniciar sesión otra vez. Sin red se sigue con
  lo guardado.
- "Entrar": correo → código de 6 dígitos (autocompletado del sistema) → sesión; tras entrar, el arranque normal
  (push, clave de firma, envío de reportes pendientes). Si el servidor no anuncia correo, lo dice. Emergencias
  siempre a un toque, sin cuenta.
- "Métodos de inicio de sesión" en el perfil: muestra los vinculados y permite vincular un correo (para recuperar
  la cuenta en otro teléfono).
- Apple y Google: el servidor ya los verifica; los botones nativos llegan con las credenciales del propietario
  (BLOQUEADO: Apple Developer, Google client id).

## Pendiente de decisión del propietario

- **PENDING DECISION** — Uso sin cuenta: hoy "Entrar" se puede cerrar y la app sigue en solo lectura (mapa,
  eventos, emergencias); reportar y publicar piden sesión. Falta decidir si V1 permite ese modo o exige cuenta.
