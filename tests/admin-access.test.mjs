import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("o cadastro próprio cria contas de usuário sem acesso administrativo", async()=>{
  const profile=await readFile(new URL("../app/api/profile/route.ts",import.meta.url),"utf8");
  const register=await readFile(new URL("../app/api/auth/register/route.ts",import.meta.url),"utf8");
  const users=await readFile(new URL("../app/api/admin/users/route.ts",import.meta.url),"utf8");
  assert.match(profile,/existing\?\.role\?\?"user"/);
  assert.match(register,/role: "user"/);
  assert.match(users,/role: "admin"/);
});

test("apenas o proprietário pode gerenciar ou visualizar outras contas", async()=>{
  const users=await readFile(new URL("../app/api/admin/users/route.ts",import.meta.url),"utf8");
  assert.match(users,/const OWNER_EMAIL = "alexsandro\.ramos@gmail\.com"/);
  assert.match(users,/user\.email\.toLowerCase\(\) === OWNER_EMAIL/);
});

test("apenas o proprietário pode limpar a base", async()=>{
  const jobs=await readFile(new URL("../app/api/admin/jobs/route.ts",import.meta.url),"utf8");
  assert.match(jobs,/const OWNER_EMAIL="alexsandro\.ramos@gmail\.com"/);
  assert.match(jobs,/user\.email\.toLowerCase\(\)!==OWNER_EMAIL/);
});

test("fontes e importações são exclusivas do proprietário", async()=>{
  const dashboard=await readFile(new URL("../app/Dashboard.tsx",import.meta.url),"utf8");
  const access=await readFile(new URL("../lib/access.ts",import.meta.url),"utf8");
  const collect=await readFile(new URL("../app/api/admin/collect/route.ts",import.meta.url),"utf8");
  const importRoute=await readFile(new URL("../app/api/admin/import/route.ts",import.meta.url),"utf8");
  const sources=await readFile(new URL("../app/api/admin/sources/route.ts",import.meta.url),"utf8");
  assert.match(access,/OWNER_EMAIL = "alexsandro\.ramos@gmail\.com"/);
  assert.match(dashboard,/item === "Fontes" \|\| item === "Importações"/);
  assert.match(dashboard,/canManageSources/);
  for(const route of [collect,importRoute,sources]) assert.match(route,/isOwnerEmail\(user\.email\)|isOwnerEmail\(u\.email\)/);
});
