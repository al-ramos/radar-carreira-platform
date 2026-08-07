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
