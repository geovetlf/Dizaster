import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
/** services/core (funciona desde src/ y desde dist/). */
export const CORE_ROOT = resolve(here, "..", "..");
export const MIGRATIONS_DIR = resolve(CORE_ROOT, "migrations");
export const defaultDataDir = () => resolve(CORE_ROOT, "..", "..", "data");
