import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("o cadastro próprio cria contas de usuário sem acesso administrativo", async()=>{
  const profile=await readFile(new URL("../app/api/profile/route.ts",import.meta.url),"utf8");
  const register=await readFile(new URL("../app/api/auth/register/route.ts",import.meta.url),"utf8");
  const users=await readFile(new URL("../app/api/admin/users/route.ts",import.meta.url),"utf8");
  assert.match(profile,/existing\?\.role\s*\?\?\s*"user"/);
  assert.match(register,/role: "user"/);
  assert.match(users,/role: "user"/);
});

test("apenas o proprietário pode alterar o papel (role) de outro usuário", async()=>{
  // Nota: este teste antigo checava app/api/admin/users/route.ts, mas a
  // troca de role acontece em users/[userId]/route.ts (PATCH). Corrigido
  // ao migrar essa rota para RBAC (Fase 2) — ver users.change_role.
  const userIdRoute=await readFile(new URL("../app/api/admin/users/[userId]/route.ts",import.meta.url),"utf8");
  assert.match(userIdRoute,/const OWNER_EMAIL = "alexsandro\.ramos@gmail\.com"/);
  assert.match(userIdRoute,/await can\(user,\s*"users\.change_role"\)/);
  assert.match(userIdRoute,/A conta principal não pode ter o papel alterado/);
});

test("apenas o proprietário pode limpar a base", async()=>{
  const jobs=await readFile(new URL("../app/api/admin/jobs/route.ts",import.meta.url),"utf8");
  // Desde a migração para RBAC (Fase 2), jobs.delete_all é a permissão que
  // controla isso — can() já embute o bypass de owner (ver lib/access.ts).
  assert.match(jobs,/await can\(user,\s*"jobs\.delete_all"\)/);
  assert.doesNotMatch(jobs,/isOwnerEmail/);
});

test("fontes e importações são exclusivas de quem tem a permissão (RBAC), owner sempre incluído", async()=>{
  const dashboard=await readFile(new URL("../app/Dashboard.tsx",import.meta.url),"utf8");
  const access=await readFile(new URL("../lib/access.ts",import.meta.url),"utf8");
  const collect=await readFile(new URL("../app/api/admin/collect/route.ts",import.meta.url),"utf8");
  const importRoute=await readFile(new URL("../app/api/admin/import/route.ts",import.meta.url),"utf8");
  const sources=await readFile(new URL("../app/api/admin/sources/route.ts",import.meta.url),"utf8");
  assert.match(access,/OWNER_EMAIL = "alexsandro\.ramos@gmail\.com"/);
  // Desde a migração para RBAC (Fase 2), can() já embute o bypass de owner —
  // não é mais preciso checar isOwnerEmail em paralelo nessas 3 rotas.
  assert.match(access,/if \(isOwnerEmail\(user\.email\)\) return true;/);
  assert.match(dashboard,/item === "Fontes" \|\| item === "Importações"/);
  assert.match(dashboard,/canManageSources/);
  assert.match(collect,/await can\(user,\s*"collect\.run"\)/);
  assert.match(importRoute,/await can\(user,\s*"import\.run"\)/);
  assert.match(sources,/await can\(user, permissionId\)/);
  for(const route of [collect,importRoute,sources]) assert.doesNotMatch(route,/isOwnerEmail/);
});
