# ADR 0164 — Versión mínima de la app por plataforma

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§6.3 define `/v1/config` como la configuración remota de la app. Sin una versión mínima, un cambio incompatible del
servidor (o una versión con un fallo grave de privacidad) no tendría forma de apartar a los teléfonos viejos.

## Decisión

- `AppConfig.appUpdate = { android: { minVersion, storeUrl }, ios: { minVersion, storeUrl } }` desde variables de
  entorno (`MIN_APP_VERSION_*`, `STORE_URL_*`; vacías = sin mínimo, sin enlace). Comparación numérica por partes
  (`compareAppVersions`, `isBelowMinVersion` en contratos, NO AI REQUIRED).
- La app manda `x-app-platform` y `x-app-version` en cada petición. El servidor solo exige la mínima al ESCRIBIR
  reportes y posts (`426 APP_UPDATE_REQUIRED`). Sin cabeceras, con otra plataforma o sin mínimo configurado no se
  bloquea nunca: la falta de datos no deja a nadie sin reportar.
- Emergencias, mapa, lectura y alertas nunca dependen de la versión.
- En la app, reportar y publicar muestran "Actualiza la app" con botón a la tienda (si hay enlace) y acceso a
  emergencias. Un reporte en cola rechazado con 426 queda "Sin enviar todavía" (ADR 0158) y se reintenta tras
  actualizar: no se pierde.
- `storeUrl` queda vacío hasta que existan las cuentas de desarrollador (BLOQUEADO en el propietario).
