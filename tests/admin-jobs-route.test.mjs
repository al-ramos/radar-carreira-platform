import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a exclusão administrativa exige confirmação para todas as vagas",async()=>{
 const [route,settings,deletion]=await Promise.all([readFile(new URL("../app/api/admin/jobs/route.ts",import.meta.url),"utf8"),readFile(new URL("../app/AdminSettings.tsx",import.meta.url),"utf8"),readFile(new URL("../lib/job-deletion.ts",import.meta.url),"utf8")]);
 assert.match(route,/export async function GET/);
 assert.match(route,/export async function DELETE/);
 assert.match(route,/EXCLUIR TODAS AS VAGAS/);
 assert.match(route,/EXCLUIR VAGAS ANTERIORES A/);
 assert.match(route,/jobs\.firstSeenAt/);
 assert.match(route,/deleteJobsAndRelated/);
 assert.match(deletion,/alertReads/);
 assert.match(deletion,/userJobStatus/);
 assert.match(deletion,/jobEvents/);
 assert.match(deletion,/jobImportRuns/);
 assert.match(settings,/EXCLUIR TODAS AS VAGAS/);
 assert.match(settings,/\/api\/admin\/backup/);
 assert.match(settings,/Limpar base de vagas/);
 assert.match(settings,/Excluir vagas por data de recebimento/);
});
