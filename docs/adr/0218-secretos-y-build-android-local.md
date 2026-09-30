# ADR 0218 — Secretos fuera del repositorio y build local de Android documentada

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

Antes de crear el repositorio en GitHub (pendiente del dueño) había que asegurar que ninguna credencial pudiera
entrar por error. `.gitignore` excluía `.env` pero no las claves de firma (`.jks`, `.keystore`), la clave APNs
(`.p8`), certificados (`.pem`, `.p12`) ni los archivos de Firebase (`google-services.json`,
`GoogleService-Info.plist`). Además, el build de Android no se puede ejecutar en el entorno del agente: el SDK se
descarga de un dominio bloqueado y EAS necesita `EXPO_TOKEN`.

## Decisión

- `.gitignore` excluye esas extensiones y archivos, más cuentas de servicio.
- `pnpm check:secrets` (sin red ni dependencias) forma parte de `pnpm check`: falla si un archivo versionado es un
  archivo de credenciales o contiene una clave privada, una clave de AWS, Google, GitHub, Slack, Expo o del tipo
  `sk-`. Solo se permite la clave de ejemplo pública de la documentación de AWS usada en pruebas.
- El build de Android queda **BLOQUEADO** en el entorno del agente (SDK inaccesible, sin `EXPO_TOKEN`).
  `expo prebuild` se verificó y `docs/MOBILE_PLATFORMS.md` documenta cómo compilar el APK gratis en cualquier
  computadora.

## Consecuencias

- Subir el código a GitHub no expone credenciales mientras `pnpm check` pase.
- El primer APK real sale en cuanto exista `EXPO_TOKEN` (EAS) o en una computadora con el Android SDK.
