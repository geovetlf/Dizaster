import { getRandomBytes } from "expo-crypto";
import { v7 } from "uuid";

/** UUIDv7 generado en el dispositivo: permite crear reportes offline con id estable (idempotencia). */
export const newId = (): string => v7({ random: getRandomBytes(16) });
