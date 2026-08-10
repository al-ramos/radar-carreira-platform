import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("lib/access.ts expõe can() com bypass de owner e resolução via roles/grupos", async () => {
  const access = await readFile(new URL("../lib/access.ts", import.meta.url), "utf8");
  assert.match(access, /export async function can\(/);
  // Owner sempre passa, sem consultar o banco.
  assert.match(access, /if \(isOwnerEmail\(user\.email\)\) return true;/);
  // Resolve roles diretas (user_roles) e roles herdadas de grupos (user_groups -> group_roles).
  assert.match(access, /userRoles/);
  assert.match(access, /userGroups/);
  assert.match(access, /groupRoles/);
  // A checagem final filtra por permissionId, não retorna true incondicionalmente.
  assert.match(access, /eq\(rolePermissions\.permissionId, permissionId\)/);
});

test("schema RBAC define as 7 tabelas esperadas", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const table of ["roles", "permissions", "rolePermissions", "groups", "groupRoles", "userRoles", "userGroups", "accessAuditLog"]) {
    assert.match(schema, new RegExp(`export const ${table} = sqliteTable`));
  }
  // profiles.role continua existindo e intocado — RBAC é camada adicional, não substituição.
  assert.match(schema, /role: text\("role", \{ enum: \["user", "admin"\] \}\)\.notNull\(\)\.default\("user"\)/);
});

test("migrations 0010 e 0011 existem e o seed cobre os 3 perfis de partida", async () => {
  const tables = await readFile(new URL("../drizzle/0010_rbac_tables.sql", import.meta.url), "utf8");
  const seed = await readFile(new URL("../drizzle/0011_rbac_seed.sql", import.meta.url), "utf8");
  for (const table of ["roles", "permissions", "role_permissions", "groups", "group_roles", "user_roles", "user_groups", "access_audit_log"]) {
    assert.match(tables, new RegExp(`CREATE TABLE \`${table}\``));
  }
  for (const roleId of ["role-admin-operacional", "role-curador-fontes", "role-visualizador"]) {
    assert.match(seed, new RegExp(roleId));
  }
  // roles.manage e groups.manage não são concedidas a nenhum perfil de partida.
  const grantsRolesManage = /'role-[\w-]+',\s*'roles\.manage'/.test(seed);
  const grantsGroupsManage = /'role-[\w-]+',\s*'groups\.manage'/.test(seed);
  assert.equal(grantsRolesManage, false, "nenhum perfil de partida deveria ter roles.manage");
  assert.equal(grantsGroupsManage, false, "nenhum perfil de partida deveria ter groups.manage");
});
