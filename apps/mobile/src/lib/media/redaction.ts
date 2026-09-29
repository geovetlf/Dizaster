import { MAX_REDACTIONS, type RedactionBox } from "@dizaster/contracts";

/** Tamaños de recuadro, como fracción del lado corto de la foto: cara lejana, cara cercana, matrícula de cerca. */
export const BOX_SIZES = { S: 0.12, M: 0.22, L: 0.36 } as const;
export type BoxSize = keyof typeof BOX_SIZES;

/**
 * Recuadro centrado donde se tocó (coordenadas de la vista), en fracciones de la foto y siempre dentro de ella.
 * Cuadrado en píxeles reales: en una foto apaisada es más estrecho en fracción de ancho.
 */
export function boxAt(tapX: number, tapY: number, viewW: number, viewH: number, size: BoxSize): RedactionBox {
  const side = BOX_SIZES[size] * Math.min(viewW, viewH);
  const w = Math.min(1, side / viewW);
  const h = Math.min(1, side / viewH);
  const x = Math.max(0, Math.min(1 - w, tapX / viewW - w / 2));
  const y = Math.max(0, Math.min(1 - h, tapY / viewH - h / 2));
  return { x, y, w, h };
}

/** Índice del último recuadro que contiene el toque (el de arriba), o -1. */
export function boxHit(boxes: readonly RedactionBox[], fx: number, fy: number): number {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h) return i;
  }
  return -1;
}

/** Tocar un recuadro lo quita; tocar fuera añade uno nuevo (hasta el máximo que acepta el servidor). */
export function toggleBoxAt(boxes: readonly RedactionBox[], tapX: number, tapY: number, viewW: number, viewH: number, size: BoxSize): RedactionBox[] {
  const hit = boxHit(boxes, tapX / viewW, tapY / viewH);
  if (hit >= 0) return boxes.filter((_, i) => i !== hit);
  if (boxes.length >= MAX_REDACTIONS) return [...boxes];
  return [...boxes, boxAt(tapX, tapY, viewW, viewH, size)];
}
