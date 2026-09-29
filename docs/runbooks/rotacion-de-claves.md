# Rotación de claves

## Clave de cifrado de columnas (`FIELD_KEYS`, ADR 0048)
Formato `FIELD_KEYS="k2:<base64 32 bytes>,k1:<...>"`: la primera cifra; todas descifran.
1. Generar la nueva: `openssl rand -base64 32`.
2. Ponerla **delante**: `FIELD_KEYS="k3:<nueva>,k2:<actual>,k1:<…>"` y desplegar API y worker.
3. Los datos cifrados son la ubicación precisa de presencia, que se generaliza al cumplir
   `PRESENCE_RETENTION_DAYS` (ADR 0004): pasado ese plazo tras la rotación, ninguna fila usa ya la clave vieja y se
   puede quitar de la lista. Antes no: esas filas dejarían de poder leerse para auditoría.
4. Si la clave vieja se filtró: rotar igual y acortar el plazo generalizando antes
   (`report.presence_evidence`: la tarea diaria del worker lo hace al vencer `expires_at`).

## Secreto de sesión (`AUTH_JWT_SECRET`)
Cambiarlo invalida todos los tokens de acceso (duran minutos); las apps renuevan con su token de refresco. Si se
sospecha que se filtró, cambiarlo y revocar las sesiones de las cuentas de staff (sesiones-comprometidas.md).

## Claves de fuentes (`SOURCE_KEY_*`) y proveedores
Rotar en el panel del emisor, actualizar el secreto y reiniciar el worker. No van en el repositorio ni en el registro.
