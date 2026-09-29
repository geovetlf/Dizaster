# Reutilización de tokens o cuenta comprometida

## Detección automática
Si un token de refresco ya usado se vuelve a presentar, el servidor revoca **toda la familia** de sesiones de ese
inicio de sesión (`revoke_reason = 'REUSE_DETECTED'`, ADR 0021). La persona tendrá que volver a entrar.

```sql
SELECT user_id, count(*), max(revoked_at) FROM identity.sessions
 WHERE revoke_reason = 'REUSE_DETECTED' AND revoked_at > now() - interval '1 day' GROUP BY user_id ORDER BY 2 DESC;
```

Varios casos en poco tiempo apuntan a robo de tokens (malware, respaldo del teléfono expuesto) o a un error de la app
al renovar: revisar primero si coincide con una versión nueva de la app.

## Cuenta comprometida
1. La persona puede cerrar sus otras sesiones desde la app (Sesiones, ADR 0029).
2. Si no puede: moderación suspende la cuenta (`SUSPEND_USER`, con motivo) para cortar el acceso; se levanta con
   `UNSUSPEND_USER` cuando recupere el control.
3. Cuenta de staff: además, revisar `moderation.actions` y `verification.transitions` de ese periodo (son de solo
   inserción) y revertir lo indebido con acciones nuevas, nunca editando el registro.
