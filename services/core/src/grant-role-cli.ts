import { STAFF_ROLES, isStaffRole } from "@dizaster/contracts";
import { buildContainer } from "./container.js";
import { loadEnv } from "./platform/config.js";

/**
 * Da o quita un rol a una cuenta por su handle (ADR 0167: queda en identity.role_changes).
 *   node dist/grant-role-cli.js <handle> admin|moderator|verifier|operator ["motivo"]
 *   node dist/grant-role-cli.js --revoke <handle> <rol> "motivo"
 */
const args = process.argv.slice(2);
const revoke = args[0] === "--revoke";
const [handle, role, reason] = revoke ? args.slice(1) : args;
if (!handle || !role || !isStaffRole(role) || (revoke && !reason)) {
  throw new Error(`Uso: grant-role-cli [--revoke] <handle> ${STAFF_ROLES.join("|")} ["motivo"]`);
}
const c = buildContainer(loadEnv());
try {
  const profileId = await c.social.profileIdByHandle(c.db, handle);
  const userId = (await c.social.userIdsForProfiles(c.db, [profileId])).get(profileId);
  if (!userId) throw new Error(`@${handle} no es una cuenta personal`);
  if (revoke) {
    await c.identity.revokeRole(userId, role, "CLI", reason!);
    console.log(`@${handle} ya no tiene el rol ${role}; sus sesiones se cerraron.`);
  } else {
    await c.identity.grantRole(userId, role, "CLI", reason ?? "Asignado por CLI");
    console.log(`@${handle} ahora tiene el rol ${role} (vale desde su próximo inicio de sesión).`);
  }
} finally {
  await c.db.end();
}
