# ADR 0250 — Mapa sin conexión de una zona: desactualizado al cambiar zona o idioma

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

El mapa sin conexión de una zona (ADR 0041) se identificaba solo por la zona. Al editar su centro o radio, o al
cambiar de idioma (el estilo depende del idioma, ADR 0193), el paquete ya no correspondía pero seguía marcado como
"listo" (§11.3, §8.3).

## Decisión

- La descarga guarda una huella: estilo, centro (4 decimales) y radio (`packFingerprint`).
- El estado compara la huella con la de la zona actual. Si difiere, o si el paquete es anterior a las huellas, queda
  "desactualizado": icono propio y un aviso para actualizarlo. El mapa viejo sigue sirviendo sin red hasta que la
  descarga nueva lo reemplaza. No se descarga nada solo: el tamaño y la red los decide la persona.

## Consecuencias

- Nadie confía en un mapa offline que no cubre su zona. Prueba en `offline-fingerprint.test.ts`.
