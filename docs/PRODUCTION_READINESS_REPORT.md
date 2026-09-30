# PRODUCTION_READINESS_REPORT — Dizaster

Fecha: 2026-09-30 · Código hasta ADR 0276 · Migraciones 0001–0103

Este informe sale de la auditoría completa Blueprint → ADR → código del 2026-09-30, hecha contra el código, las
pruebas y los ADR. Solo se marca un bloqueo cuando un documento dice qué falta y quién lo da. No se inventan
decisiones, límites, precios ni capacidades.

## 1. Veredicto

El código de V1 (app iOS y Android, backend, motores de reporte, evento, verificación, alertas, moderación, costos y
el plano de entrega propio) está **listo en código y probado localmente**. **No se puede publicar en producción
todavía**: faltan cuentas, credenciales, facturación y decisiones que solo da el propietario (sección 4). Nada de lo
pendiente se puede resolver sin su autorización.

## 2. Verificación ejecutada (local, 2026-09-30)

| Verificación | Resultado |
| --- | --- |
| `pnpm check`: lint, fronteras de módulos, secretos, workflows, typecheck, build, pruebas | ✅ contracts 40, geo-kit 39, móvil 269, backend 608 (3 omitidas), delivery 33 |
| Empaquetado móvil iOS + Android (`bundle:check`) y paridad nativa (`native:check`) | ✅ |
| Migraciones 0001–0103 sobre PostgreSQL 16 + PostGIS + H3; prueba de restauración de respaldo | ✅ |
| Gitleaks (269+ commits), Trivy (dependencias, Dockerfiles, IaC), Semgrep con reglas propias | ✅ sin hallazgos HIGH/CRITICAL |
| Imagen del backend: build, Trivy de la imagen, usuario no root, sin gestores de paquetes | ✅ 0 HIGH/CRITICAL con arreglo |
| `tofu validate` staging y producción (OpenTofu 1.13.0, proveedor google 7.46.1), `dzd iac-check` | ✅ |
| `dzd verify` contra la API local | ✅ salud, OpenAPI, configuración, catálogo, mapa (PostGIS), feed. `/health/ready` da 503 sin worker, como debe |
| OSV-Scanner | ⏳ OSV.dev no es alcanzable desde este entorno. Correrá en GitHub Actions |

## 3. Estado por área

| Área | Estado | Evidencia / qué falta |
| --- | --- | --- |
| App iOS + Android con paridad (RF-01) | READY en código · BLOCKED_BY_CREDENTIALS para compilar | `native:check`, 67 archivos de pruebas. Falta `EXPO_TOKEN`. Para iOS, cuenta Apple Developer (US$99/año, `MOBILE_PLATFORMS.md`) |
| Red social: posts, comentarios, reacciones, seguir, etiquetas, feed, búsqueda, negocios | READY | Cupos sin carrera (ADR 0268), fallos visibles (ADR 0270) |
| Avisos por comentarios y respuestas | NEEDS_DECISION | Pendiente del propietario: ¿V1 los tiene? ¿con qué límite? |
| Reportes con presencia física y privacidad | READY | Lógica de presencia, cifrado de la ubicación precisa, anti-triangulación |
| Atestación real del dispositivo | BLOCKED_BY_CREDENTIALS | Solo hay verificador de desarrollo; producción no arranca sin uno real. Necesita el primer build y las cuentas de Apple y Google |
| Retención de ubicación en categorías sensibles | NEEDS_DECISION | D1 de producto (en espera) |
| Motor de eventos, deduplicación, fusión | READY | "No, es otro" guarda la respuesta; qué hacer con ella es D2 (NEEDS_DECISION) |
| Verificación basada en reglas; la IA nunca confirma | READY | Regla Semgrep propia además de las pruebas |
| Fuentes oficiales del piloto (IGP, INDECI, SENAMHI) | BLOCKED_BY_OWNER | Sin adapter; validar feeds y términos. USGS activo; el resto PLANNED hasta revisar términos |
| FIRMS (incendios) | BLOCKED_BY_CREDENTIALS | Falta `MAP_KEY` |
| Alertas: reglas, idioma, límites | READY · BLOCKED_BY_CREDENTIALS para enviar | APNs `.p8` y cuenta de servicio de Firebase |
| Mapa MapLibre | READY en código · BLOCKED_BY_BILLING las teselas propias | Hoy apunta a teselas de demostración. PMTiles propias esperan almacenamiento (D-18) |
| Fronteras en disputa (D-17) | NEEDS_DECISION / BLOCKED_BY_LEGAL | Criterio del propietario y revisión legal |
| Media: fotos y video, sin metadatos de ubicación | READY · 720p en Android BLOCKED_BY_CREDENTIALS | Transcodificación nativa con el primer build |
| Moderación, apelaciones, listas de términos | READY | Listas vacías hasta que el propietario las llene. Duración de suspensiones: NEEDS_DECISION |
| Detección de CSAM | BLOCKED_BY_LEGAL | Proveedor y procedimiento legal (ADR 0145) |
| Requerimientos de autoridades | READY el registro · BLOCKED_BY_LEGAL la entrega | Solo registro auditado, sin entrega de datos hasta tener asesoría legal (ADR 0139) |
| Textos legales | BLOCKED_BY_LEGAL | Sin versiones hasta tener asesoría |
| Identidad: Apple, Google, correo, MFA | READY en código · BLOCKED_BY_CREDENTIALS / BLOCKED_BY_OWNER | IDs de Apple y Google. El correo necesita que el propietario elija proveedor; luego se escribe el adapter |
| Uso sin cuenta | NEEDS_DECISION | Pendiente del propietario |
| Estado de lanzamiento por país | NEEDS_DECISION | `launchStatus` existe pero no se aplica |
| Números de emergencia | READY para Perú | 4 verificados en Perú; los demás países marcados "por verificar" |
| Donaciones (D-15) | READY en código · BLOCKED_BY_OWNER los datos | Directorio vacío hasta verificar organizaciones (ADR 0274) |
| Publicidad (D-14) | READY (apagada) | Reglas escritas y probadas, sin anuncios en V1 |
| IA (AI Core, AI Router) | READY y apagada | Todo funciona sin IA. Elegir proveedor y presupuesto: BLOCKED_BY_OWNER |
| Costos: presupuestos, kill switches, degradación | READY | Presupuestos en 0 hasta que el propietario los fije |
| Observabilidad del producto (OpenTelemetry, SLO, latido del worker) | READY | Destino desplegado depende de D-18 |
| Seguridad de la aplicación: cabeceras, límites, auditoría inmutable, roles, MFA de staff | READY | WAF y HSTS del dominio dependen de D-18 y D-21 |
| Revisión nativa pt/fr | BLOCKED_BY_OWNER | |

### Plano de entrega (Dizaster Delivery Control Plane)

| Capacidad | Estado | Evidencia / qué falta |
| --- | --- | --- |
| CLI `dzd`: impacto, gates, políticas, autonomía, auditoría encadenada, informe, métricas | READY | `tools/delivery`, 33 pruebas, separado del runtime (`check:boundaries`) |
| CI endurecido, SBOM, escáneres, imagen con manifiesto verificable | READY | Jobs `check`, `delivery`, `security`, `iac`, `image`, `supply-chain` |
| Despliegue gradual, promoción del mismo digest, rollback de tráfico | READY en seco · BLOCKED_BY_BILLING real | `dzd deploy/promote/rollback`. `--execute` espera D-18 |
| Validación de configuración antes de desplegar | READY | `dzd config-check` con las reglas del propio backend |
| Migraciones seguras y rollback de base de datos | READY | Candado, checksum, bloqueo de cambios destructivos, runbook `migracion-fallida.md` |
| Respaldos | READY local · BLOCKED_BY_OWNER el destino | Bucket en IaC. Días de retención y proyecto: propietario |
| IaC OpenTofu (IAM mínimo, WIF, registro, secretos, Cloud Run, respaldos, vigilancia, presupuesto) | READY validado · BLOCKED_BY_BILLING aplicar | Base de staging fuera a propósito: D-23 |
| Firma cosign y procedencia | BLOCKED_BY_OWNER | Necesita el repositorio de GitHub (D-20) |
| Informe en el PR, protección de `main`, entornos de GitHub | BLOCKED_BY_OWNER | D-20 (repositorio) y D-24 (plan) |
| Pruebas de carga (k6) y E2E móvil (Maestro) | NOT_IMPLEMENTED | k6 se puede construir. Maestro necesita el build de desarrollo |
| Niveles de autonomía | READY | Nivel vigente 2. Subir a 3–5: BLOCKED_BY_OWNER |

## 4. Lo que solo puede dar el propietario

Credenciales y cuentas (BLOCKED_BY_CREDENTIALS):
1. `EXPO_TOKEN` (cuenta gratuita de Expo): primer build, APK, video 720p en Android, atestación, E2E.
2. Apple Developer (US$99/año) y Google Play Console (US$25 una vez), según `MOBILE_PLATFORMS.md`. Para iOS, publicar, APNs y App Attest.
3. Clave APNs `.p8` y cuenta de servicio de Firebase: push real.
4. Services ID de Apple y client ID de Google: inicio de sesión real.
5. `MAP_KEY` de FIRMS.

Facturación y nube (BLOCKED_BY_BILLING):
6. D-18: proyectos de Google Cloud, facturación y presupuesto mensual por entorno. También la cuenta de facturación y el monto para `infra/tofu`.
7. D-23: base de datos de staging. Recomendado: PostgreSQL en e2-micro.
8. Almacenamiento de media y teselas (GCS o R2) y bucket de estado de OpenTofu.
9. Verificar con prueba real que Cloud SQL soporta la extensión `h3`. Si no la soporta, se elige entre las opciones de ADR 0261.

Repositorio (BLOCKED_BY_OWNER):
10. Crear el repositorio de GitHub (D-20) y elegir plan (D-24). Con eso se sube el historial del bundle y se activan protección, entornos, cosign e informe en PR.

Legal (BLOCKED_BY_LEGAL):
11. Textos legales, entrega de datos a autoridades, detección de CSAM, fronteras en disputa.

Decisiones de producto (NEEDS_DECISION):
12. D1 retención sensible, D2 "No, es otro", D3 reputación visible.
13. Estado de lanzamiento por país, duración de suspensiones, uso sin cuenta, avisos por comentarios.

Datos y contactos (BLOCKED_BY_OWNER):
14. Contacto del cliente de ingesta.
15. Fuentes oficiales del piloto: IGP, INDECI, SENAMHI.
16. Proveedor de correo.
17. Organizaciones para donar.
18. Listas de términos de moderación.
19. Revisión nativa pt/fr.
20. Proveedor de IA y su presupuesto, si algún día se quiere.

## 5. Preparación de producción hecha (sin gastar ni publicar)

- La imagen se construye y escanea, y su manifiesto por digest se genera y se verifica (la firma cosign espera al repositorio). El despliegue a Cloud Run está escrito y probado en seco.
- La IaC completa de staging y producción está validada. Los `*.tfvars.example` tienen marcadores, sin valores inventados.
- Runbooks: despliegue, rollback de aplicación y de base de datos, respaldo y restauración, incidentes, costos, rotación de claves.
- Checklist de activación, cuando el propietario dé 6–10:

  | Paso | Comando |
  | --- | --- |
  | 1 | `tofu init` y `tofu plan` en staging |
  | 2 | `dzd iac-check --plan plan.json` |
  | 3 | Aplicar, con la autorización del propietario |
  | 4 | Cargar los secretos |
  | 5 | `dzd config-check` |
  | 6 | Job de migraciones |
  | 7 | `dzd deploy --execute` en staging |
  | 8 | `dzd verify` |
  | 9 | `dzd promote --execute`, con la aprobación del propietario |

**Punto de parada:** nada de lo anterior se ejecuta en la nube. Crearía recursos facturables y necesita credenciales
personales.

## 6. Contradicciones y huecos reales encontrados

1. D-17 figura como aprobada en ADR 0001 pero como pendiente en el estado. En la práctica, lo que la frena es la revisión legal.
2. §5.2 habla de "reputación visible" y §13.3 dice que nunca se muestra como número (es D3).
3. §4.3 prefiere almacenamiento sin costo de egreso (R2); ADR 0261 propone Cloud Storage. Se resuelve con D-18.
4. Los pesos de presencia están versionados como constantes de código, no como configuración (§8.2). Recalibrarlos exige desplegar. La divergencia es menor.
5. Los casos de IA permitidos en V1 (traducción bajo demanda, resúmenes) no tienen consumidor. Cumple "IA opcional y apagada".

Corregidos en esta revisión:
- Referencias rotas y lista de bloqueos incompleta en `IMPLEMENTATION_STATUS.md` (atestación, correo, CSAM, fuentes oficiales, push).
- `MOBILE_PLATFORMS.md` desactualizado.
- Donaciones D-15 sin implementar (ADR 0274).
