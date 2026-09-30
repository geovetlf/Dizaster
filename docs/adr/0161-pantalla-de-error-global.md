# ADR 0161 — Pantalla de error global con acceso a emergencias

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno (todo local)

## Contexto

§5.22 exige que un fallo de la app nunca deje a la persona sin poder llamar a emergencias. Un error al dibujar una
pantalla dejaba la pantalla roja de React Native (en desarrollo) o la app en blanco (en producción). El proveedor de
errores remoto sigue BLOQUEADO (DSN de Sentry pendiente del propietario).

## Decisión

- `ErrorBoundary` exportado desde el layout raíz (mecanismo de Expo Router): cualquier error de una pantalla muestra
  `CrashScreen` en lugar de la navegación. No depende de la navegación ni de la sesión: "Reintentar" vuelve a dibujar
  y debajo están los números de emergencia del dataset local (componente `EmergencyNumbers`, el mismo que usa la
  pantalla de emergencia), que se llaman directo con `tel:`.
- Registro local de errores (`errors.json`, máx. 20, lo más reciente primero): errores de pantallas y los globales de
  JavaScript (`ErrorUtils`, sin cambiar su comportamiento). Se redacta al guardar: tokens, correos, coordenadas e ids.
  No sale del teléfono; se ve y se borra en "Acerca de" para contarlo a soporte.
- Cuando el propietario entregue el DSN, el mismo `recordError` es el punto donde se conectará el proveedor (detrás
  de su interfaz, con la misma redacción).
