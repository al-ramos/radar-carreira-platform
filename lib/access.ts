import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/index";
import { groupRoles, rolePermissions, userGroups, userRoles } from "../db/schema";

/** Ações operacionais que permanecem sob controle do proprietário da conta. */
export const OWNER_EMAIL = "alexsandro.ramos@gmail.com";

export function isOwnerEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === OWNER_EMAIL;
}

/**
 * Checagem granular de permissão via RBAC (roles/grupos/permissions).
 *
 * A proprietária sempre passa, sem consultar o banco — é a trava mais forte
 * e permanece intocada. Para os demais usuários, a permissão final é a
 * união das roles atribuídas diretamente (`user_roles`) com as roles
 * herdadas de grupos (`user_groups` -> `group_roles`).
 *
 * Isso é uma camada adicional sobre `profiles.role` ("user"|"admin"), que
 * continua existindo e sendo checada como está nas rotas que só precisam
 * de admin/não-admin. `can()` é para quando a rota precisar de granularidade
 * (ex.: alguém que só pode gerenciar fontes, sem ser admin completo).
 */
export async function can(
  user: { userId: string; email: string } | null | undefined,
  permissionId: string,
): Promise<boolean> {
  if (!user) return false;
  if (isOwnerEmail(user.email)) return true;

  const db = getDb();

  const directRoleIds = (await db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.userId)))
    .map(row => row.roleId);

  const groupIds = (await db.select({ groupId: userGroups.groupId }).from(userGroups).where(eq(userGroups.userId, user.userId)))
    .map(row => row.groupId);
  const groupRoleIds = groupIds.length
    ? (await db.select({ roleId: groupRoles.roleId }).from(groupRoles).where(inArray(groupRoles.groupId, groupIds))).map(row => row.roleId)
    : [];

  const roleIds = [...new Set([...directRoleIds, ...groupRoleIds])];
  if (!roleIds.length) return false;

  const grant = (await db.select({ roleId: rolePermissions.roleId }).from(rolePermissions)
    .where(and(inArray(rolePermissions.roleId, roleIds), eq(rolePermissions.permissionId, permissionId)))
    .limit(1))[0];

  return Boolean(grant);
}
