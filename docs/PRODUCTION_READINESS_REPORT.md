# DIZASTER PRODUCTION READINESS AUDIT

Fecha: 2026-10-10 · Código hasta ADR 0309 · Migraciones 0001–0105 · Todo en `main` por PR (sin force push)

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

## 2. Verificación ejecutada (local y en GitHub Actions, actualizada 2026-10-10)

| Verificación | Resultado |
| --- | --- |
| `pnpm check`: lint, fronteras de módulos, secretos, workflows y versiones alineadas, typecheck, build y pruebas | ✅ Pruebas: contracts 42, geo-kit 39, móvil 288, backend 685, delivery 97 |
| Empaquetado móvil iOS + Android (`bundle:check`) y paridad nativa | ✅ |
| Migraciones 0001–0105 sobre PostgreSQL 16 + PostGIS + H3; restauración de respaldo | ✅ |
| Gitleaks: historial (285 commits) y árbol de trabajo | ✅ sin hallazgos |
| Trivy (dependencias, Dockerfiles, IaC) y Semgrep con reglas propias | ✅ sin HIGH/CRITICAL |
| Imagen del backend: usuario no root, sin gestores de paquetes | ✅ |
| OpenTofu: `validate` de bootstrap, staging y producción; `tofu test` del stack (8 casos); `dzd iac-check` | ✅ |
| Firma cosign y atestaciones, de extremo a extremo con registro local y clave local | ✅ La firma keyless espera GitHub |
| Entrega local real: candidata, 10 %, 100 %, carga, candidata rota rechazada, rollback | ✅ ADR 0282 |
| k6 50 peticiones/s durante 30 s contra la API local | ✅ p95 5 ms, sin 5xx. La base local tiene pocos datos: sirve para detectar regresiones, no predice producción |
| Planes de consulta con volumen: 20 000 eventos, 40 000 posts y 40 000 comentarios | ✅ En cada `pnpm check`: ninguna lectura pública caliente recorre una tabla grande. "Para ti" con sesión pasó de 1,5 s a 19 ms (ADR 0309) |
| OSV-Scanner y `pnpm audit` | ✅ En GitHub Actions. Solo dos avisos HIGH sin arreglo upstream (`node-forge`, `braces`, herramientas de Expo), aceptados por el propietario hasta el 2026-11-07 y acotados a versión y ruta (ADR 0304, 0305) |
| Push a `github.com/geovetlf/Dizaster` | ✅ Sin force push. `main` protegida desde el 2026-10-08: cada cambio entra por PR con los 7 jobs de CI en verde (check, delivery, report-comment, supply-chain, security, iac, image); PRs #10–#52 |

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
| `dzd`: impacto, gates, política, autonomía, auditoría encadenada, informe, métricas | READY | 94 pruebas. Separado del runtime y del AI Core |
| CI: gates, SBOM, escáneres, imagen con manifiesto | READY | En verde en GitHub Actions en cada PR (#10–#30) |
| Repositorio oficial y push | READY | `geovetlf/Dizaster`, trabajo por ramas y PRs |
| Informe de delivery en cada PR | READY | ADR 0284: un comentario que se actualiza en cada push |
| Reglas de `main`, entornos `staging` y `production` | READY | Aplicados por el propietario el 2026-10-08 (ADR 0303). `main` verificada por la API. Los entornos solo se pueden leer dentro de Actions: la guarda de `deliver.yml` los verifica en cada entrega y se detiene si faltan protecciones o no puede leerlos (ADR 0306). Opcional: ruleset de etiquetas `v*` |
| Firma keyless, procedencia SLSA y SBOM atestado | READY en código · BLOCKED BY AUTHORIZATION | Identidad `geovetlf/Dizaster` fijada. Se activa con el primer push y la nube (D-18) |
| Despliegue gradual, promoción del mismo digest, rollback | READY: ensayado local · FINANCIAL AUTHORIZATION REQUIRED en la nube | `deliver.yml`. Producción exige la aprobación del propietario |
| Destino local, proxy de tráfico, carga (`dzd load`, k6) | READY | ADR 0282 |
| Delivery Agent opcional | READY | ADR 0283. Propone; el ejecutor valida; no se salta ningún gate. Agente de reglas, sin IA |
| Migraciones seguras y respaldos | READY | Candado, checksum y bloqueo de cambios destructivos. El destino de los respaldos espera D-18 |
| IaC OpenTofu: proyectos, IAM mínimo, WIF, registro, secretos, Cloud Run, base de datos (cloudsql, vm o external), media, estado, presupuesto | READY validado · FINANCIAL AUTHORIZATION REQUIRED para aplicar | Nunca se aplicó. Base de staging: D-23 |
| Nivel de autonomía | READY en 2 | Staging sigue manual por decisión del propietario (2026-10-08). Subir a 4 o 5: BLOCKED BY AUTHORIZATION |

## 5. Lo que solo puede dar el propietario

En orden de impacto:

1. ✅ **Reglas de `main` y entornos**: aplicados el 2026-10-08. Quedan abiertos a propósito los PR de Dependabot #3
   (PostGIS 17) y #41 (Node 25), con sus condiciones en ADR 0308. Ver §8.
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

1. ✅ **`main` protegida** desde el 2026-10-08 (ADR 0303). Ya no es un riesgo abierto.
2. **Cloud SQL no admite la extensión `h3`.** Verificado el 2026-10-10 en la lista oficial de extensiones (ADR 0308).
   Con el código actual, el modo `cloudsql` no sirve. Para D-23 quedan dos caminos: `vm` o `external`, o bien mover
   H3 a la aplicación con otro ADR.
3. **Latencia sin datos reales.** Mitigado el 2026-10-10 (ADR 0309). Con 20 000 eventos, 40 000 posts y 40 000
   comentarios, ninguna lectura pública caliente recorre una tabla grande, y una prueba lo exige en cada `pnpm check`.
   El feed era el único caso lento y bajó de 1,5 s a 19 ms. Falta medir en staging, con la red y los datos reales.
4. **Límite por IP.** Detrás de un balanceador o CDN mal configurado, todas las personas compartirían una IP y el
   límite de 300 por minuto las frenaría. La IaC ya pone `TRUST_PROXY=true`; falta confirmar en staging que la API ve la IP de cada cliente.
5. **Atestación y push reales sin probar en dispositivo.** Dependen del primer build.
6. **Un blob de 2.2 MB en el historial** (`.whl`, commit 3729a0a, eliminado en 3fd4b63). No es un secreto. No se
   reescribió el historial.
7. **Traducciones pt y fr sin revisión nativa.**

## 7. Siguiente paso mínimo para producción

1. ✅ Push de `main` sin force y CI en verde en cada PR.
2. ✅ El propietario aplicó las reglas de `main` y los entornos (2026-10-08).
3. Con `EXPO_TOKEN`, el primer APK de prueba.
4. Con D-18 y D-23, staging y luego producción. Los pasos exactos están en §9.

## 8. Cierre del backlog sin autorización (2026-10-01)

Todo lo que se podía hacer sin la intervención del propietario está hecho, probado y en `main`. Los ADR 0284–0302 se
fusionaron por PR, cada uno con `pnpm check` completo en local y los 7 checks de GitHub Actions en verde:

- check
- delivery
- report-comment
- supply-chain
- security
- iac
- image

| PR | ADR | Qué cerró |
| --- | --- | --- |
| #10–#19 | 0284–0292 | Informe en PR, errores de subida por código, formato de números, caché de media, paginación de mis reportes y de mi moderación, fuentes escalonadas, enfriamiento de exportación, límite de búsquedas, errores de red traducidos |
| #23 | 0296 | Requerimientos de autoridades y cambios de rol por páginas |
| #24 | 0297 | Proveedor `hashicorp/google` 8.x en staging, producción y bootstrap |
| #25 | — | Banda de presencia traducida en moderación |
| #26 | 0298 | Candidatos de deduplicación por distancia; cola de duplicados paginada con total real |
| #27 | 0299 | Registros de accesos a presencia y a originales paginados, con alias |
| #28 | 0300 | Errores visibles y anunciados en todas las pantallas |
| #29 | 0301 | Códigos internos traducidos en moderación y administración |
| #30 | 0302 | Historial completo del evento en moderación, con totales |
| #32 | 0303 | Reglas de `main` y entornos (aplicados por el propietario el 2026-10-08); guarda `dzd github-guard` en la entrega |
| #36 | 0303 | Reglas aplicadas y verificadas por la API |
| #37 | 0304 | `source-map-js` 1.2.2, excepción temporal aprobada, parches de la imagen, prueba con hora relativa |
| #40 | — | `globals` 17, `vitest` 5.0.3; Dependabot ignora mayores de TypeScript y `@types/node` |
| #43 | 0305 | Excepciones de avisos acotadas a paquete, versión y ruta; aviso en CI 14 días antes |
| #44 | 0306 | Guarda de entrega: solo desde `main`, `staging` limitado, `production` sin bypass de administradores, "no verificable" distinto de "incorrecto" |
| #45 | 0308 | Node y PostgreSQL alineados en CI; Dependabot cubre bootstrap; Cloud SQL sin `h3` |
| #46 | 0307 | Contacto configurable en el User-Agent de ingesta |

Dependabot:

- **Fusionados:** #4, #6, #7, #8 y #9 (acciones de GitHub, 2026-10-01); #33 (`setup-node` 7), #38 (dependencias de
  producción), #42 (eslint 10.12, `@types/node` 22.20.5). #40 tomó `globals` 17 y `vitest` 5.0.3.
- **Cerrados:** #1 y #2 (entraron unificados en #24); #34 y #39 (TypeScript 7 y `@types/node` 26 no son compatibles;
  Dependabot ya no los propone); #35 (reemplazado por #38); #5 (reemplazado por #41).
- **Abiertos a propósito, en rojo hasta cumplir sus condiciones** (ADR 0308; `check:workflows` exige versiones
  alineadas):
  - #3 (PostGIS 17): la imagen local, CI y el destino usan PostgreSQL 16. Pasar a 17 necesita un ADR de migración de
    datos y D-23.
  - #41 (Node 25): Node 25 ya no tiene soporte desde el 2026-06-01. La migración va a una LTS (26 es LTS desde el
    2026-10-28), con `.nvmrc`, `engines`, imágenes y CI juntos. Node 22 tiene soporte hasta el 2027-04-30.

## 9. Pasos exactos: de hoy a staging y a producción

Cada paso dice quién lo hace. Nada se despliega por fusionar en `main`, porque `deliver.yml` solo corre a mano.

### A. Antes de staging (costo 0)

1. ✅ **Hecho el 2026-10-08.** El propietario aplicó las reglas de `main` y los entornos; el agente verificó `main`
   por la API (ADR 0303). Falta solo el ruleset de etiquetas `v*`, que no bloquea nada hasta la primera versión.
2. **Propietario:** crear una cuenta gratuita de Expo y cargar el secreto `EXPO_TOKEN` y la variable
   `DIZASTER_EXPO_OWNER`. **Agente:** `eas init` y luego `mobile-build` con el perfil `preview`, y entrega el APK.
   Ver el runbook, §2.
3. **Propietario:** instalar el APK en su Android y confirmar que abre, que el mapa carga y que puede reportar.

### B. Staging (requiere facturación: D-18 y D-23)

1. **Propietario:**
   - crear los proyectos `staging` y `production` en Google Cloud, más uno de administración si quiere;
   - vincular la facturación;
   - fijar el presupuesto mensual y la región;
   - dar al agente `roles/viewer` y `roles/iam.securityReviewer` solo en esos proyectos.
2. **Propietario:** elegir el modo de la base de staging (`cloudsql`, `vm` o `external`) y el almacenamiento de media
   (GCS o R2).
3. **Agente:**
   1. Completar `infra/tofu/envs/staging/staging.tfvars`.
   2. Ejecutar `pnpm dzd env-check --env staging`.
   3. En `infra/tofu/bootstrap`, `tofu plan`.
4. **Propietario:** aplicar el bootstrap, que crea el bucket de estado.
5. **Agente:**
   1. En `infra/tofu/envs/staging`: `tofu init -backend-config="bucket=<estado>"`.
   2. `tofu plan -out plan`, luego `tofu show -json plan > plan.json`.
   3. `pnpm dzd iac-check --plan plan.json`.
   4. Entregar el plan.
6. **Propietario:** revisar y aplicar el plan de staging.
7. **Propietario:** crear los secretos sin que pasen por OpenTofu:
   - `database-password` y `database-url`;
   - las claves de media.

   Los comandos exactos están en el runbook, §4 y §5.
8. **Agente:** `node scripts/github-bootstrap.mjs … --outputs outputs.json --execute`, que carga las variables de
   Actions (`GCP_WIF_PROVIDER` y otras). Desde ahí, CI publica y firma la imagen en cada push a `main`.
9. **Agente:** con `vm` o `external`, comprobar `CREATE EXTENSION h3` en la base real. `cloudsql` no la admite (ADR 0308).
10. **Agente:**
    1. Lanzar `deliver.yml` con el digest firmado y `promote=false`. El job aplica las migraciones, despliega al 10 %
       y luego al 100 %.
    2. `pnpm dzd verify --url <staging> --slo`.
    3. `pnpm dzd load` con el escenario de humo.
11. **Agente:** confirmar que la API ve la IP real de cada cliente (riesgo 4).
12. **Propietario:** probar el APK contra staging.

### C. Producción (requiere además cuentas, decisiones y asesoría legal)

Producción no arranca sin verificador de atestación real (`container.ts`) ni sin push real (`PUSH_DRIVER=live`,
`platform/config.ts`). El correo puede quedar en `none` si solo se entra con Apple o Google. Antes hacen falta:

1. **Propietario:** Apple Developer (US$99 al año) y Google Play (US$25 una vez). Con eso:
   - la clave APNs `.p8`;
   - la cuenta de servicio de Firebase;
   - los IDs de inicio de sesión de Apple y de Google.
2. **Agente:** implementar los verificadores App Attest y Play Integrity con vectores grabados de un dispositivo real.
   Ver el runbook, §7.
3. **Propietario:** elegir el proveedor de correo, si se quiere entrar con correo. **Agente:** escribir el adapter.
4. **Asesoría legal:**
   - términos y privacidad (`data/legal/documents.json`);
   - CSAM;
   - entrega de datos a autoridades;
   - fronteras en disputa.
5. **Propietario:** decisiones de producto:
   - D1, D2 y D3;
   - uso sin cuenta;
   - estado de lanzamiento por país;
   - duración de las suspensiones;
   - avisos sociales.

   Cualquier respuesta se implementa como ADR.
6. **Propietario:** datos:
   - contacto de ingesta;
   - fuentes del piloto (IGP, INDECI, SENAMHI);
   - `MAP_KEY` de FIRMS;
   - organizaciones para donar;
   - listas de términos;
   - revisión nativa de pt y fr.
7. **Agente:** `tofu plan` de producción, más `dzd iac-check`. **Propietario:** aplica.
8. **Agente:** lanzar `deliver.yml` con el mismo digest que pasó staging y `promote=true`. GitHub pide la aprobación
   del propietario en el entorno `production`.
9. **Propietario:** aprobar. **Agente:** `dzd verify --slo`. Si falla, `dzd rollback`, que ya está ensayado.
10. **Propietario:** publicar en las tiendas.

## 10. Estado de cada bloqueo (revisado el 2026-10-10)

Cada fila dice qué falta, por qué el agente no puede resolverlo, qué quedó listo y el siguiente paso mínimo. Tipos:

- **temporal**: se resuelve con una acción única.
- **condicionado**: depende de otro bloqueo.
- **permanente**: por diseño, siempre lo hace una persona.

| Bloqueo | Falta | Por qué no lo hace el agente | Ya listo | Tipo | Siguiente paso mínimo | Costo para desbloquear |
| --- | --- | --- | --- | --- | --- | --- |
| `EXPO_TOKEN` y primer build | Cuenta de Expo y token | Es una credencial del propietario | `mobile-build.yml` manual, `eas.json`, prebuild verificado, bundle iOS y Android en CI | temporal | Propietario: crear la cuenta y cargar `EXPO_TOKEN` (runbook §2) | 0 (plan gratuito de EAS, con cupo mensual limitado) |
| Google Cloud y facturación (D-18) | Proyectos, facturación, presupuesto, región | Crea gasto y cuentas | IaC validada y nunca aplicada, presupuesto y alertas en código, `dzd env-check` e `iac-check` | temporal | Propietario: crear los proyectos y fijar el presupuesto (runbook §3) | El que fije el propietario. No se estima sin precios verificados de la región |
| Base de staging (D-23) | Elegir `vm`, `external` o `cloudsql` (este último exige mover H3 a la app) | Decisión de costo y operación | Módulos `database-vm` y `database-cloudsql`, migrador seguro, respaldo con prueba de restauración | condicionado (D-18) | Propietario: elegir modo. Recomendación técnica: `vm` | Según modo y tamaño; se calcula con el plan de OpenTofu |
| Media (GCS o R2) | Elegir proveedor y claves | Cuenta y gasto del propietario | Driver S3 probado contra un S3 local, caché, media sin metadatos | condicionado (D-18) | Propietario: elegir proveedor (runbook §5) | Según uso |
| Proveedor de correo | Elegir proveedor | Decisión y cuenta del propietario | `EMAIL_PROVIDER=none`; se puede entrar solo con Apple o Google | temporal | Propietario: elegir proveedor o confirmar que no hace falta en V1 | Según proveedor |
| Atestación real | App Attest y Play Integrity | Necesita cuentas de Apple y Google y un build | Interfaz, verificador de desarrollo, producción no arranca sin el real | condicionado (`EXPO_TOKEN` y cuentas) | Propietario: cuentas de Apple (US$99 al año) y Google Play (US$25 una vez) | US$99 al año + US$25 una vez |
| Push real | Clave APNs `.p8` y cuenta de servicio de Firebase | Credenciales del propietario | Drivers APNs y FCM, `PUSH_DRIVER=live` obligatorio en producción | condicionado (cuentas) | Propietario: generar las claves (runbook §9) | 0 |
| CSAM | Proveedor y procedimiento de reporte | Decisión legal | Moderación, denuncias y cola de revisión | permanente hasta asesoría | Asesoría legal | Según asesoría |
| Textos legales | Términos y privacidad revisados | Decisión legal | `data/legal/documents.json` con versionado y aceptación registrada | permanente hasta asesoría | Asesoría legal | Según asesoría |
| Fuentes del piloto (IGP, INDECI, SENAMHI) | Validar feeds y términos de uso | Términos de terceros; el agente no los acepta por el propietario | Registro de fuentes, ingesta con reintentos y escalonada, USGS activo | temporal | Propietario: confirmar términos de cada fuente | 0 |
| FIRMS | `MAP_KEY` gratuita | Credencial del propietario | Adaptador listo (ADR 0067) | temporal | Propietario: pedir la clave en NASA FIRMS | 0 |
| Contacto de ingesta | Correo o URL | Dato del propietario | `INGEST_CONTACT` y aviso en `config-check` (ADR 0307) | temporal | Propietario: dar el contacto | 0 |
| Decisiones de producto | D1, D2, D3, uso sin cuenta, estado de lanzamiento por país, duración de suspensiones, avisos sociales | Son decisiones de producto | Todo lo que no depende de ellas | temporal | Propietario: responder cada una | 0 |
| Fronteras en disputa (D-17) | Criterio | Decisión legal y de producto | Mapa con datos abiertos | permanente hasta asesoría | Asesoría | Según asesoría |
| Datos y revisiones | Revisión nativa de pt y fr, listas de términos, organizaciones para donar, textos regionales | Requieren personas con conocimiento local | Mecanismos con listas vacías | temporal | Propietario: proveerlos | 0 |
| Pruebas reales | Dispositivo, push, staging, producción | Necesitan los bloqueos anteriores | Ensayo local completo de la entrega (ADR 0282), guardas, rollback | condicionado | Primer APK, luego staging | — |
| Excepción `node-forge` y `braces` | Arreglo upstream | No hay versión corregida publicada | Acotada a versión y ruta, vence sola el 2026-11-07, aviso en CI desde el 2026-10-23 | temporal | Revisar el 2026-11-07, o antes si sale el arreglo | 0 |
| Ruleset de etiquetas `v*` | Importar `tags.json` | Esta sesión no puede escribir reglas de GitHub | `tags.json` versionado. Hoy ningún workflow construye desde etiquetas y la entrega va por digest, así que aporta poco | opcional | Propietario: importarlo antes de que una versión se publique por etiqueta (`delivery/policy.json` ya acepta firmas de `refs/tags/v*`) | 0 |

**Configuración manual de GitHub: NOT_VERIFIABLE.** Desde la sesión del agente no se puede leer la API de entornos.
No se dan por correctas sin evidencia:

| Casilla | Estado |
| --- | --- |
| `production`: "Allow administrators to bypass configured protection rules" desmarcada | NOT_VERIFIABLE |
| `staging`: "Deployment branches: Protected branches only" | NOT_VERIFIABLE |

Consecuencias:
- **Producción sigue bloqueada** mientras no estén verificadas.
- La guarda de `deliver.yml` (ADR 0306) las comprueba en la primera ejecución. Si alguna falta, o si la API no
  responde, se detiene: "incorrecto" en el primer caso, "no verificable" en el segundo.
- No bloquean el desarrollo local ni las tareas independientes.

