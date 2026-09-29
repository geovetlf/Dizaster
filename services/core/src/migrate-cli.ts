import { createPool } from "./platform/db.js";
import { migrate } from "./platform/migrate.js";
import { MIGRATIONS_DIR } from "./platform/paths.js";

const url = process.env["DATABASE_URL"];
if (!url) throw new Error("DATABASE_URL es obligatorio");
const db = createPool(url);
const ran = await migrate(db, MIGRATIONS_DIR);
console.log(ran.length ? `Migraciones aplicadas: ${ran.join(", ")}` : "Base de datos al día");
await db.end();
