import { STAFF_ROLES, isStaffRole } from "@dizaster/contracts";
import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Da un rol a una cuenta por su handle (p. ej. para ver el tablero de costo en la app).
 *   node dist/grant-role-cli.js <handle> admin|moderator|verifier|operator
 */
const [handle, role] = process.argv.slice(2);
if (!handle || !role || !isStaffRole(role)) throw new Error(`Uso: grant-role-cli <handle> ${STAFF_ROLES.join("|")}`);
const c = buildContainer(loadEnv());
try {
  const profileId = await c.social.profileIdByHandle(c.db, handle);
  const userId = (await c.social.userIdsForProfiles(c.db, [profileId])).get(profileId);
  if (!userId) throw new Error(`@${handle} no es una cuenta personal`);
  await c.identity.grantRole(userId, role);
  console.log(`@${handle} ahora tiene el rol ${role} (vale desde su próximo inicio de sesión).`);
} finally {
  await c.db.end();
}
