import { v7 } from "uuid";

/** UUIDv7: ordenable por tiempo, generable en cualquier nodo o en el dispositivo. */
export const newId = (): string => v7();
