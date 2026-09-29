# ADR 0049 — Edad mínima de 16 años

- Estado: Aceptado · Fecha: 2026-09-29 · Blueprint D-13

## Decisión
- Para publicar, reportar, comentar, reaccionar, compartir, subir media, crear negocios o editar el perfil hace falta
  haber confirmado la edad mínima. Leer el mapa, el feed y los números de emergencia no la exige: la información de
  seguridad sigue disponible para cualquiera.
- La edad mínima es dato por país (`country-config.json`, `defaults.minAge` = 16); un país puede subirla sin cambiar código.
- `POST /v1/me/age` recibe año y mes de nacimiento, calcula la edad y solo guarda la edad mínima confirmada y la
  fecha. La fecha de nacimiento nunca se almacena (minimización de datos). Por debajo del mínimo responde 403
  `UNDER_MIN_AGE` y no guarda nada.
- La app pide la edad al entrar si falta y, si no alcanza, recuerda el bloqueo en el teléfono (SecureStore) y
  muestra solo lectura con acceso a los números de emergencia.

## Fuera de alcance
- Verificación documental de edad: no es proporcional para V1 ni barata.
- El texto legal del aviso de edad lo define el propietario (pendiente junto con términos y privacidad).
