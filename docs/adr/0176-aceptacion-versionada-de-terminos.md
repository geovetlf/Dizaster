# ADR 0176 — Aceptación versionada de términos y políticas (mecanismo)

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Hace falta registrar qué versión de los términos, la privacidad y las normas aceptó cada cuenta, y pedir de nuevo la
aceptación cuando cambian. Los textos legales están BLOQUEADOS hasta tener asesoría legal: aquí solo va el mecanismo.

## Decisión

- `data/legal/documents.json`: TERMS, PRIVACY y COMMUNITY_GUIDELINES con `version`, `url` y `required`. Hoy todas las
  versiones son `null`: no se pide ni se bloquea nada. Publicar un texto = fijar versión y url en ese archivo.
- Migración 0083: `identity.policy_acceptances` (cuenta, documento, versión, plataforma y versión de la app, fecha),
  única por cuenta+documento+versión y de solo inserción.
- `GET /v1/me/policies` (estado de lo publicado) y `POST /v1/me/policies/accept` (solo la versión vigente; si no,
  409 `POLICY_VERSION_MISMATCH`). Aceptar se permite aunque la cuenta esté suspendida.
- Con un documento `required` publicado, los mismos caminos de contenido e interacción que exigen la edad mínima
  (ADR 0049) responden 428 `POLICY_ACCEPTANCE_REQUIRED` hasta aceptarlo. Leer, ajustes, apelar, borrar la cuenta y
  emergencias nunca se bloquean. Caché de 30 s por cuenta y conjunto de versiones: una versión nueva se nota al instante.
- App: al arrancar con sesión, si hay algo pendiente abre "Términos y políticas" (cada documento se abre en el
  navegador; "Acepto" o "Ahora no").

## Consecuencias

- Al borrar la cuenta, las aceptaciones quedan con el id interno como prueba. Si deben borrarse también es una
  decisión legal pendiente (el registro de solo inserción impide borrarlo sin una migración explícita).
- Los textos, sus versiones y qué documentos son obligatorios siguen siendo del propietario con asesoría legal.
