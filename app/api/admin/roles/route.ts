import { asc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getDb } from "../../../../db/index";
import { groupRoles, permissions, roles, rolePermissions, userRoles } from "../../../../db/schema";
import { can } from "../../../../lib/rbac";

export const dynamic = "force-dynamic";

// Permissões que nunca podem ser atribuídas a uma role por esta rota — só a
// proprietária as possui, via bypass direto em can(). Ver decisão de
// governança da revisão de segurança de 2026-08-09.
const OWNER_ONLY_PERMISSIONS = new Set(["roles.manage", "groups.manage"]);

async function admin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  return await can(user, "roles.manage") ? user : null;
}

async function roleWithCounts() {
  const db = getDb();
  const [roleRows, grantRows, userCounts, groupCounts] = await Promise.all([
    db.select().from(roles).orderBy(asc(roles.createdAt)),
    db.select({ roleId: rolePermissions.roleId, permissionId: rolePermissions.permissionId }).from(rolePermissions),
    db.select({ roleId: userRoles.roleId, count: sql<number>`count(*)` }).from(userRoles).groupBy(userRoles.roleId),
    db.select({ roleId: groupRoles.roleId, count: sql<number>`count(*)` }).from(groupRoles).groupBy(groupRoles.roleId),
  ]);
  const permissionsByRole = new Map<string, string[]>();
  for (const grant of grantRows) {
    const list = permissionsByRole.get(grant.roleId) ?? [];
    list.push(grant.permissionId);
    permissionsByRole.set(grant.roleId, list);
  }
  const usersByRole = new Map(userCounts.map(row => [row.roleId, Number(row.count)]));
  const groupsByRole = new Map(groupCounts.map(row => [row.roleId, Number(row.count)]));
  return roleRows.map(role => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    permissionIds: (permissionsByRole.get(role.id) ?? []).sort(),
    userCount: usersByRole.get(role.id) ?? 0,
    groupCount: groupsByRole.get(role.id) ?? 0,
  }));
}

export async function GET() {
  if (!await admin()) return NextResponse.json({ error: "Acesso restrito ao gerenciamento de perfis." }, { status: 403 });
  return NextResponse.json({ roles: await roleWithCounts() });
}

export async function POST(request: Request) {
  if (!await admin()) return NextResponse.json({ error: "Acesso restrito ao gerenciamento de perfis." }, { status: 403 });
  const body = await request.json() as { name?: unknown; description?: unknown; permissionIds?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const permissionIds = Array.isArray(body.permissionIds) ? body.permissionIds.filter((id): id is string => typeof id === "string") : [];

  if (!name || name.length > 80) {
    return NextResponse.json({ error: "Informe um nome para o perfil (até 80 caracteres)." }, { status: 400 });
  }
  const blocked = permissionIds.filter(id => OWNER_ONLY_PERMISSIONS.has(id));
  if (blocked.length) {
    return NextResponse.json({ error: `As permissões ${blocked.join(", ")} são exclusivas da administração principal e não podem ser atribuídas a um perfil.` }, { status: 403 });
  }

  const db = getDb();
  const existing = (await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1))[0];
  if (existing) return NextResponse.json({ error: "Já existe um perfil com este nome." }, { status: 409 });

  if (permissionIds.length) {
    const validRows = await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.id, permissionIds));
    const validIds = new Set(validRows.map(row => row.id));
    const invalid = permissionIds.filter(id => !validIds.has(id));
    if (invalid.length) return NextResponse.json({ error: `Permissões desconhecidas: ${invalid.join(", ")}.` }, { status: 400 });
  }

  const id = `role-${crypto.randomUUID()}`;
  const now = new Date();
  await db.insert(roles).values({ id, name, description: description || null, isSystem: false, createdAt: now });
  if (permissionIds.length) {
    await db.insert(rolePermissions).values(permissionIds.map(permissionId => ({ roleId: id, permissionId })));
  }
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
