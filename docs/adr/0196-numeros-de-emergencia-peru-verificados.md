# ADR 0196 — Números de emergencia de Perú contrastados con fuentes oficiales

- Estado: aceptada (2026-09-30) · AI_REQUIRED: no · COST: ninguno

## Contexto

§5.11 y C-06: los números de emergencia deben estar verificados contra fuentes oficiales, empezando por el país
piloto. Los 43 números de 29 países estaban en `NEEDS_VERIFICATION`, Perú incluido.

## Decisión

- Perú, contrastado el 2026-09-30 con documentos de dominios oficiales `gob.pe`:
  - 105 Policía Nacional, 116 Bomberos, 106 SAMU: PRONATEL (MTC), documento de la Central 911 (2023-02-20), y el
    directorio de emergencias del MIMP. → `VERIFIED`, con las URLs en `source`.
  - 100 Línea 100 (Programa Aurora, MIMP): mismo documento de PRONATEL. → `VERIFIED`.
  - 115 Defensa Civil: **sin confirmar**. La página de contacto de INDECI no lo lista y las páginas de gob.pe no
    responden desde el entorno de trabajo. Sigue `NEEDS_VERIFICATION` con esa nota.
- No se añade 911: según PRONATEL es una central para Lima y Callao que integra 100/105/106/116 y estaba prevista
  para 2025; sin confirmación de que opere, no se muestra.
- Versión del catálogo `emergency-2026.09.3`: las apps la actualizan solas.

## Consecuencias

- Pendiente: 115 e INDECI, estado de la Central 911, y el resto de países (misma regla: solo `VERIFIED` con una
  fuente oficial citada). Ningún número se quita por no estar verificado: se muestra igual (mejor un número probable
  que ninguno) y la app avisa cuando ninguno de los números de un país está verificado; en Perú ese aviso ya no sale.
