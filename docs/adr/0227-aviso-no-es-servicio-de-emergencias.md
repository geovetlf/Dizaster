# ADR 0227 — Aviso visible: Dizaster no reemplaza a los servicios de emergencia

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

C-18 y §5.11 piden decir de forma explícita que Dizaster no es un servicio de emergencias. Solo existía "Si hay
riesgo para la vida, llama primero a emergencias", y solo al reportar categorías graves. Los términos legales siguen
pendientes de asesoría y no se tocan aquí.

## Decisión

- La pantalla de Emergencia muestra, bajo el título y antes de los números: "Dizaster no reemplaza a los servicios de
  emergencia ni a las autoridades. Si hay peligro, llama primero a los números de abajo." Se marca como alerta para
  lectores de pantalla.
- Acerca de explica que Dizaster no despacha ayuda ni recibe llamadas.
- Es texto de producto en los cuatro idiomas, no un documento legal. Si la asesoría legal redacta otro texto, se
  reemplaza en el catálogo sin cambiar código.

## Consecuencias

- Nadie confunde la app con una línea de emergencias.
- Prueba en `not-emergency-notice.test.ts`.
