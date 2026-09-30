# ADR 0211 — Borrar la cuenta limpia el teléfono; cerrar sesión en este teléfono

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§13.2 (supresión) y §5.1 (sesiones). Al borrar la cuenta, la app solo olvidaba la identidad y la caché de lectura.
En el teléfono quedaban:

- la cola de reportes, con la ubicación precisa y sus fotos;
- el borrador y su media (ADR 0191);
- el registro de errores;
- las copias exportadas de los datos (ADR 0038).

Los reportes en cola no llevan dueño: con otra cuenta en el mismo teléfono se habrían enviado a su nombre. Además,
`api.logout` existía pero ninguna pantalla permitía cerrar sesión.

## Decisión

- `lib/account/wipe.ts` (`wipeLocalUserData`) recibe los almacenes como interfaz y los limpia en pasos
  independientes: si uno falla, los demás siguen. Los almacenes son la cola con su media, el borrador con su media, la
  carpeta `pending-media`, el registro de errores, la caché de lectura y los `dizaster-export-*.json` de la caché.
  `wipe-device.ts` conecta los almacenes reales, los mismos en Android e iOS.
- `forgetAndRestart`, que se usa al borrar la cuenta, llama a esa limpieza.
- Nuevo "Cerrar sesión en este teléfono" en Perfil:
  - Pide confirmación y avisa si hay reportes sin enviar, que se descartan.
  - Revoca la sesión en el servidor (`POST /v1/auth/logout`). Sin red no se puede revocar, pero el teléfono ya no
    guarda el token y la sesión caduca sola.
  - Después hace la misma limpieza y vuelve a la pantalla de entrar.
- No se borra lo que no es de la cuenta: idioma, país preferido, catálogos, números de emergencia, mapas offline y la
  confirmación de edad del teléfono.
- Textos nuevos en es, en, pt y fr.

## Consecuencias

- Un teléfono compartido o vendido no conserva datos ni reportes de la cuenta anterior.
- Prueba `apps/mobile/test/wipe.test.ts`.
