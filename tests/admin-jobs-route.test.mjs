import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a exclusão administrativa exige confirmação para todas as vagas",async()=>{
 const route=await readFile(new URL("../app/api/admin/jobs/route.ts",import.meta.url),"utf8");
 assert.match(route,/export async function DELETE/);
 assert.match(route,/EXCLUIR TODAS AS VAGAS/);
 assert.match(route,/alertReads/);
 assert.match(route,/userJobStatus/);
 assert.match(route,/jobEvents/);
});
