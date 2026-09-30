# Dependencias corregidas en el repositorio

Solo para dependencias transitivas con una vulnerabilidad cuyo arreglo no se puede usar tal cual. Cada una se conecta
con `overrides` en `pnpm-workspace.yaml` y se quita en cuanto la dependencia que la trae se actualice.

| Paquete | Por qué | Quién lo trae | Cuándo se quita |
| --- | --- | --- | --- |
| `decode-uri-component` 0.5.0 en CommonJS | GHSA-vcc3-ghjq-m6fr (0.2.2). La 0.5.0 corrige, pero es solo ESM y `query-string` 7 la carga con `require()` | `expo-router` → `query-string@7` | Cuando `expo-router` use una versión de `query-string` con la dependencia corregida |
