# ADR 0281 — Motor de idiomas: sin textos en español fuera del español y textos regionales por país

- Estado: Aceptado
- Fecha: 2026-09-30
- Relación con el Blueprint: D-19 (idiomas), §5; ADR 0069, 0105, 0197, 0216
- IA: no. Costo: 0.

## Contexto

La instrucción del 2026-09-30 19:32 pide un motor de idiomas con respaldo, formatos regionales, catálogos por país,
textos del sistema, errores, avisos y accesibilidad. La auditoría del motor (ADR 0216) encontró estos huecos:

- Con un código de error que la app no conoce, una persona en inglés, portugués o francés veía el mensaje del servidor
  en español.
- Los motivos de las acciones automáticas de moderación (límite y ocultamiento por denuncias) se escriben en español
  en el servidor y la app los mostraba tal cual en "Mis avisos de moderación", en la cola y en el caso.
- El interruptor de cada función de pago tenía como etiqueta de accesibilidad el identificador interno (`ai`).
- No había forma de ajustar un texto para un país sin crear otro idioma (por ejemplo, "es-PE" frente a "es-AR").
- El quechua y el aimara figuran en `country-config.json` de Perú, pero no tienen catálogo.

## Decisión

1. **Errores.** Fuera del español, un código desconocido se traduce por su estado HTTP:
   - 401 → sin sesión;
   - 403 → sin permiso;
   - 404 → no encontrado;
   - 409 → conflicto;
   - 429 → límite de tasa;
   - 503 → sobrecarga;
   - otro 5xx → error interno;
   - otro 4xx → validación.

   El mensaje en español del servidor solo se muestra en español.
2. **Moderación automática.** `actionReasonText` (app) muestra el motivo de un moderador tal cual, porque es texto
   libre de una persona. El de una regla se muestra con `ruleReason_LIMIT`, `ruleReason_HIDE` o `ruleReason_OTHER`
   en el idioma de quien lee. En español se conserva el del servidor, que trae el número de denuncias.
3. **Accesibilidad.** Los interruptores de costo usan `costKillSwitchA11y` ("Función de pago {feature}").
4. **Textos regionales.** El archivo es `data/locales/ui-regional.json`: `{ "es-PE": { clave: texto } }`.
   - Se copia al bundle, igual que los demás datos de referencia, y funciona sin red.
   - `t()` busca primero el texto de `appLocale` (idioma de la app + región del teléfono o del país) y después el del
     idioma.
   - `checkRegionalOverrides` rechaza cinco casos: un locale mal formado, un idioma no soportado, una clave
     inexistente, un texto vacío y variables distintas de las del texto base.
   - El archivo se entrega vacío a propósito: ningún texto regional se inventa.
5. **Quechua y aimara.** Quedan registrados como BLOQUEADOS hasta tener una traducción nativa revisada. No se generan
   con IA: la interfaz nunca se traduce con IA (ADR 0216). Agregarlos sigue el procedimiento de
   `docs/LANGUAGE_ENGINE.md`.

## Consecuencias

- Ningún texto del sistema llega en español a quien usa otro idioma, salvo el texto libre que escribe una persona.
- Un país puede ajustar palabras con solo un cambio de datos, validado por pruebas.
- Pruebas: `apps/mobile/test/language-regional.test.ts` y los casos nuevos de `server-error.test.ts`.
