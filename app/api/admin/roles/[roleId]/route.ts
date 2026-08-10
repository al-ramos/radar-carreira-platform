import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getDb } from "../../../../../db/index";
import { groupRoles, permissions, roles, rolePermissions, userRoles } from "../../../../../db/schema";
import { can } from "../../../../../lib/rbac";

export const dynamic = "force-dynamic";

const OWNER_ONLY_PERMISSIONS = new Set(["roles.manage", "groups.manage"]);

async function admin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  return await can(user, "roles.manage") ? user : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  if (!await admin()) return NextResponse.json({ error: "Acesso restrito ao gerenciamento de perfis." }, { status: 403 });
  const { roleId } = await params;
  const db = getDb();
  const role = (await db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
  if (!role) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });

  const body = await request.json() as { name?: unknown; description?: unknown; permissionIds?: unknown };
  const patch: { name?: string; description?: string | null } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 80) return NextResponse.json({ error: "Informe um nome válido para o perfil (até 80 caracteres)." }, { status: 400 });
    const clash = (await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1))[0];
    if (clash && clash.id !== roleId) return NextResponse.json({ error: "Já existe um perfil com este nome." }, { status: 409 });
    patch.name = name;
  }
  if (body.description !== undefined) {
    patch.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if (Object.keys(patch).length) {
    await db.update(roles).set(patch).where(eq(roles.id, roleId));
  }

  if (body.permissionIds !== undefined) {
    if (!Array.isArray(body.permissionIds) || body.permissionIds.some(id => typeof id !== "string")) {
      return NextResponse.json({ error: "permissionIds deve ser uma lista de strings." }, { status: 400 });
    }
    const permissionIds = [...new Set(body.permissionIds as string[])];
    const blocked = permissionIds.filter(id => OWNER_ONLY_PERMISSIONS.has(id));
    if (blocked.length) {
      return NextResponse.json({ error: `As permissões ${blocked.join(", ")} são exclusivas da administração principal e não podem ser atribuídas a um perfil.` }, { status: 403 });
    }
    if (permissionIds.length) {
      const validRows = await db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.id, permissionIds));
      const validIds = new Set(validRows.map(row => row.id));
      const invalid = permissionIds.filter(id => !validIds.has(id));
      if (invalid.length) return NextResponse.json({ error: `Permissões desconhecidas: ${invalid.join(", ")}.` }, { status: 400 });
    }
    // Substitui o conjunto inteiro — mais simples e previsível que diff.
    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (permissionIds.length) {
      await db.insert(rolePermissions).values(permissionIds.map(permissionId => ({ roleId, permissionId })));
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ roleId: string }> }) {
  if (!await admin()) return NextResponse.json({ error: "Acesso restrito ao gerenciamento de perfis." }, { status: 403 });
  const { roleId } = await params;
  const db = getDb();
  const role = (await db.select().from(roles).where(eq(roles.id, roleId)).limit(1))[0];
  if (!role) return NextResponse.json({ error: "Perfil não encontrado." }, { status: 404 });
  if (role.isSystem) return NextResponse.json({ error: "Perfis do sistema não podem ser excluídos." }, { status: 403 });

  const [userCount, groupCount] = await Promise.all([
    db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, roleId)),
    db.select({ groupId: groupRoles.groupId }).from(groupRoles).where(eq(groupRoles.roleId, roleId)),
  ]);
  if (userCount.length || groupCount.length) {
    return NextResponse.json({
      error: `Este perfil está atribuído a ${userCount.length} usuário(s) e ${groupCount.length} grupo(s). Remova as atribuições antes de excluir.`,
    }, { status: 409 });
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  await db.delete(roles).where(eq(roles.id, roleId));
  return NextResponse.json({ ok: true });
}
