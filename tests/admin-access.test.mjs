import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminRoutes=[
  "../app/api/profile/route.ts",
  "../app/api/admin/audit/route.ts",
  "../app/api/admin/backup/route.ts",
  "../app/api/admin/collect/route.ts",
  "../app/api/admin/gmail-key/route.ts",
  "../app/api/admin/linkedin-key/route.ts",
  "../app/api/admin/import/route.ts",
  "../app/api/admin/monitor/route.ts",
  "../app/api/admin/quality/route.ts",
  "../app/api/admin/report/route.ts",
  "../app/api/admin/settings/route.ts",
  "../app/api/admin/sources/route.ts",
  "../app/api/admin/users/route.ts",
];

test("a proprietária do Sites tem acesso administrativo", async()=>{
  const sources=await Promise.all(adminRoutes.map(path=>readFile(new URL(path,import.meta.url),"utf8")));
  for(const source of sources)assert.match(source,/prof\.andreiamr@gmail\.com/);
});

test("pipeline permite remover somente o vínculo do usuário", async()=>{
 const route=await readFile(new URL("../app/api/pipeline/route.ts",import.meta.url),"utf8");
 assert.match(route,/export async function DELETE/);
 assert.match(route,/delete\(userJobStatus\)/);
 assert.match(route,/userJobStatus\.userId/);
});
