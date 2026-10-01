# DIZASTER PRODUCTION READINESS AUDIT

Fecha: 2026-09-30 · Código hasta ADR 0298 · Migraciones 0001–0105 · 285 commits

Esta auditoría compara el Blueprint con los ADR, el código y las pruebas. Solo se marca un bloqueo cuando está
escrito qué falta y quién lo da. No se inventan decisiones, límites, precios ni capacidades. El procedimiento exacto
para levantar cada bloqueo está en `docs/runbooks/activacion-bloqueos.md`.

Etiquetas:

- **READY**: hecho y probado; no necesita nada más para el MVP.
- **BLOCKED BY AUTHORIZATION**: espera una decisión o una acción del propietario (una cuenta, un permiso, una
  elección de producto).
- **BLOCKED BY EXTERNAL DEPENDENCY**: espera algo de un tercero (feeds, términos de uso, un build en la nube).
- **LEGAL REVIEW REQUIRED**: espera asesoría legal.
- **FINANCIAL AUTHORIZATION REQUIRED**: genera gasto.
- **NOT REQUIRED FOR MVP**: queda fuera de V1 a propósito.

## 1. Veredicto

El código de V1 está **terminado y probado localmente**:

- la app iOS y Android con paridad;
- el backend;
- los motores de reporte, evento, verificación, alertas, moderación, idiomas y costos;
- el Delivery Control Plane propio.

El camino completo de entrega se ensayó con contenedores reales (ADR 0282): despliegue gradual, verificación, carga,
rechazo y rollback.

**No se puede publicar todavía.** Faltan la facturación de Google Cloud, cuentas de
tiendas y credenciales, decisiones de producto y revisión legal. Nada de eso lo puede dar el agente.

## 2. Verificación ejecutada (local, 2026-09-30)

| Verificación | Resultado |
| --- | --- |
| `pnpm check`: lint, fronteras de módulos, secretos, workflows, typecheck, build y pruebas | ✅ Pruebas: contracts 40, geo-kit 39, móvil 277, backend 627 (+3 omitidas), delivery 90 |
| Empaquetado móvil iOS + Android (`bundle:check`) y paridad nativa | ✅ |
| Migraciones 0001–0105 sobre PostgreSQL 16 + PostGIS + H3; restauración de respaldo | ✅ |
| Gitleaks: historial (285 commits) y árbol de trabajo | ✅ sin hallazgos |
| Trivy (dependencias, Dockerfiles, IaC) y Semgrep con reglas propias | ✅ sin HIGH/CRITICAL |
| Imagen del backend: usuario no root, sin gestores de paquetes | ✅ |
| OpenTofu: `validate` de bootstrap, staging y producción; `tofu test` del stack (8 casos); `dzd iac-check` | ✅ |
| Firma cosign y atestaciones, de extremo a extremo con registro local y clave local | ✅ La firma keyless espera GitHub |
| Entrega local real: candidata, 10 %, 100 %, carga, candidata rota rechazada, rollback | ✅ ADR 0282 |
| k6 50 peticiones/s durante 30 s contra la API local | ✅ p95 5 ms, sin 5xx. La base local tiene pocos datos: sirve para detectar regresiones, no predice producción |
| OSV-Scanner | ✅ En GitHub Actions (PR #10): `uuid` y `decode-uri-component` corregidos, 0 avisos |
| Push a `github.com/geovetlf/Dizaster` | ✅ `main` = 58cc151, sin force push. CI completo en verde en PR #10 (6 jobs) |

## 3. Producto

| Área | Etiqueta | Evidencia / qué falta |
| --- | --- | --- |
| App iOS + Android con paridad | READY en código · BLOCKED BY AUTHORIZATION para compilar | Falta `EXPO_TOKEN`, que viene de una cuenta gratuita de Expo |
| Publicar en tiendas | FINANCIAL AUTHORIZATION REQUIRED | Apple Developer US$99 al año; Google Play US$25 una vez |
| Red social: posts, comentarios, reacciones, seguir, feed, búsqueda, negocios | READY | ADR 0268 y 0270 |
| Avisos por comentarios y respuestas | BLOCKED BY AUTHORIZATION | Decisión de producto pendiente |
| Reportes con presencia física y privacidad | READY | Cifrado de la ubicación precisa y protección contra triangulación |
| Retención de la ubicación en categorías sensibles (D1) | BLOCKED BY AUTHORIZATION | Decisión de producto |
| Eventos, deduplicación, fusión | READY | Qué hace "No, es otro" es D2 y espera decisión |
| Reputación en el perfil (D3) | BLOCKED BY AUTHORIZATION | Decisión de producto |
| Verificación por reglas; la IA nunca confirma | READY | Pruebas más una regla Semgrep propia |
| Atestación real del dispositivo | BLOCKED BY AUTHORIZATION | Necesita el primer build y las cuentas de Apple y Google. Producción no arranca sin ella |
| Fuentes oficiales del piloto (IGP, INDECI, SENAMHI) | BLOCKED BY EXTERNAL DEPENDENCY | Validar los feeds y los términos de uso. USGS está activo |
| FIRMS (incendios) | BLOCKED BY AUTHORIZATION | Falta la `MAP_KEY` gratuita |
| Push real (APNs y FCM) | BLOCKED BY AUTHORIZATION | Clave `.p8` y cuenta de servicio de Firebase |
| Mapa MapLibre | READY en código · FINANCIAL AUTHORIZATION REQUIRED para las teselas propias | Hoy usa teselas de demostración |
| Media: fotos y video sin metadatos de ubicación | READY · video 720p en Android BLOCKED BY AUTHORIZATION | La transcodificación nativa llega con el primer build |
| Moderación y apelaciones | READY | Las listas de términos quedan vacías hasta que el propietario las llene. La duración de las suspensiones espera decisión |
| Detección de CSAM | LEGAL REVIEW REQUIRED | Proveedor y procedimiento de reporte |
| Requerimientos de autoridades | READY el registro · LEGAL REVIEW REQUIRED la entrega | Solo registro auditado |
| Textos legales | LEGAL REVIEW REQUIRED | |
| Fronteras en disputa (D-17) | LEGAL REVIEW REQUIRED | |
| Inicio de sesión: Apple, Google, correo, MFA | READY en código · BLOCKED BY AUTHORIZATION | IDs de Apple y Google. El proveedor de correo lo elige el propietario |
| Uso sin cuenta; estado de lanzamiento por país | BLOCKED BY AUTHORIZATION | Decisiones de producto |
| Números de emergencia | READY para Perú | Los demás países aparecen como "por verificar" |
| Motor de idiomas: es, en, pt, fr; plurales CLDR; formatos regionales; textos regionales por país; sin español fuera del español | READY | ADR 0216 y 0281 |
| Revisión nativa de pt y fr | BLOCKED BY AUTHORIZATION | |
| Quechua y aimara | NOT REQUIRED FOR MVP | Necesitan traducción nativa; nunca con IA |
| RTL | NOT REQUIRED FOR MVP | La infraestructura existe; ningún idioma de V1 es RTL |
| Donaciones (D-15) | READY en código · BLOCKED BY AUTHORIZATION los datos | Directorio vacío |
| Publicidad (D-14) | NOT REQUIRED FOR MVP | Reglas escritas, apagada |
| AI Core: límite de tasa, cortocircuito, prompts versionados, registro de modelos, evaluación, pistas asíncronas | READY y apagada | ADR 0280. Nada la requiere |
| Proveedor de IA | NOT REQUIRED FOR MVP | Si se quiere: FINANCIAL AUTHORIZATION REQUIRED |
| Costos: presupuestos, kill switches, degradación | READY | Topes en 0 hasta que el propietario los fije |
| Observabilidad: OpenTelemetry, SLO, latido del worker | READY | Su destino desplegado depende de D-18 |
| Seguridad: cabeceras, límites, auditoría inmutable, roles, MFA del personal | READY | |
| Sentry | NOT REQUIRED FOR MVP | OpenTelemetry cubre V1 |
| E2E móvil (Maestro) | BLOCKED BY AUTHORIZATION | Necesita el primer build (`EXPO_TOKEN`) |

## 4. Entrega (Dizaster Delivery Control Plane)

| Capacidad | Etiqueta | Evidencia / qué falta |
| --- | --- | --- |
| `dzd`: impacto, gates, política, autonomía, auditoría encadenada, informe, métricas | READY | 90 pruebas. Separado del runtime y del AI Core |
| CI: gates, SBOM, escáneres, imagen con manifiesto | READY | En verde en GitHub Actions (PR #10) |
| Repositorio oficial y push | READY | `geovetlf/Dizaster`, trabajo por ramas y PRs |
| Informe de delivery en cada PR | READY | ADR 0284: un comentario que se actualiza en cada push |
| Reglas de `main`, entornos `staging` y `production`, CODEOWNERS | BLOCKED BY AUTHORIZATION | `scripts/github-bootstrap.mjs`, en seco hasta el visto bueno. En repositorios privados depende del plan de GitHub (D-24) |
| Firma keyless, procedencia SLSA y SBOM atestado | READY en código · BLOCKED BY AUTHORIZATION | Identidad `geovetlf/Dizaster` fijada. Se activa con el primer push y la nube (D-18) |
| Despliegue gradual, promoción del mismo digest, rollback | READY: ensayado local · FINANCIAL AUTHORIZATION REQUIRED en la nube | `deliver.yml`. Producción exige la aprobación del propietario |
| Destino local, proxy de tráfico, carga (`dzd load`, k6) | READY | ADR 0282 |
| Delivery Agent opcional | READY | ADR 0283. Propone; el ejecutor valida; no se salta ningún gate. Agente de reglas, sin IA |
| Migraciones seguras y respaldos | READY | Candado, checksum y bloqueo de cambios destructivos. El destino de los respaldos espera D-18 |
| IaC OpenTofu: proyectos, IAM mínimo, WIF, registro, secretos, Cloud Run, base de datos (cloudsql, vm o external), media, estado, presupuesto | READY validado · FINANCIAL AUTHORIZATION REQUIRED para aplicar | Nunca se aplicó. Base de staging: D-23 |
| Nivel de autonomía | READY en 2 | Subir a 4 (staging autónomo) o 5: BLOCKED BY AUTHORIZATION |

## 5. Lo que solo puede dar el propietario

En orden de impacto:

1. **Revisar y fusionar los PRs abiertos**, y autorizar las reglas de `main` y los entornos
   (`scripts/github-bootstrap.mjs`). Costo 0.
2. **`EXPO_TOKEN`** de una cuenta gratuita de Expo. Desbloquea el primer APK, el video 720p, Maestro y el camino a la
   atestación. Costo 0.
3. **D-18**: proyectos de Google Cloud, facturación y presupuesto mensual por entorno.
4. **D-23**: modo de la base de staging (`cloudsql`, `vm` o `external`).
5. Almacenamiento de media: GCS o R2.
6. Cuentas de Apple Developer y Google Play; clave APNs y Firebase; IDs de inicio de sesión de Apple y Google.
7. Proveedor de correo.
8. Asesoría legal: textos legales, CSAM, requerimientos de autoridades, fronteras en disputa.
9. Decisiones de producto:
   - D1, D2 y D3;
   - avisos por comentarios;
   - uso sin cuenta;
   - estado de lanzamiento por país;
   - duración de las suspensiones.
10. Datos y contactos:
    - contacto de ingesta;
    - fuentes del piloto;
    - organizaciones para donar;
    - listas de términos;
    - revisión de pt y fr.

## 6. Riesgos abiertos

1. **`main` sin protección.** Hasta que el propietario autorice las reglas (`scripts/github-bootstrap.mjs`), GitHub
   no exige CI en verde ni revisión antes de fusionar.
2. **La extensión `h3` en Cloud SQL no está verificada.** Si falta, se usa el modo `vm` o `external` (ADR 0261 y 0278).
3. **Latencia sin datos reales.** Las pruebas de carga corrieron sobre una base casi vacía.
4. **Límite por IP.** Detrás de un balanceador o CDN mal configurado, todas las personas compartirían una IP y el
   límite de 300 por minuto las frenaría. La IaC ya pone `TRUST_PROXY=true`; falta confirmar en staging que la API ve la IP de cada cliente.
5. **Atestación y push reales sin probar en dispositivo.** Dependen del primer build.
6. **Un blob de 2.2 MB en el historial** (`.whl`, commit 3729a0a, eliminado en 3fd4b63). No es un secreto. No se
   reescribió el historial.
7. **Traducciones pt y fr sin revisión nativa.**

## 7. Siguiente paso mínimo para producción

1. ✅ Push de `main` sin force y CI en verde (PR #10).
2. El propietario fusiona los PRs y autoriza las reglas de `main`.
3. Con `EXPO_TOKEN`, el primer APK de prueba.
4. Con D-18 y D-23:
   1. `tofu plan` → `dzd iac-check`;
   2. el propietario aplica;
   3. `deliver` a staging;
   4. `dzd verify --slo`;
   5. promoción con la aprobación del propietario.
