import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("a exclusão administrativa exige confirmação para todas as vagas",async()=>{
 const [route,settings,deletion,migration,secondMigration,lifecycle]=await Promise.all([readFile(new URL("../app/api/admin/jobs/route.ts",import.meta.url),"utf8"),readFile(new URL("../app/AdminSettings.tsx",import.meta.url),"utf8"),readFile(new URL("../lib/job-deletion.ts",import.meta.url),"utf8"),readFile(new URL("../drizzle/0037_remove_jobs_before_2026_08.sql",import.meta.url),"utf8"),readFile(new URL("../drizzle/0038_remove_jobs_before_2026_08_15.sql",import.meta.url),"utf8"),readFile(new URL("../lib/lifecycle.ts",import.meta.url),"utf8")]);
 assert.match(route,/export async function GET/);
 assert.match(route,/export async function DELETE/);
 assert.match(route,/EXCLUIR TODAS AS VAGAS/);
 assert.match(route,/deleteJobsAndRelated/);
 assert.match(deletion,/alertReads/);
 assert.match(deletion,/userJobStatus/);
 assert.match(deletion,/jobEvents/);
 assert.match(deletion,/jobImportRuns/);
 assert.match(migration,/DELETE FROM `jobs` WHERE `published_at` < 1785542400000/);
 assert.match(migration,/DELETE FROM `user_job_status`/);
 assert.match(migration,/DELETE FROM `draft_outbox`/);
 assert.match(migration,/DELETE FROM `triage_history`/);
 assert.match(migration,/DELETE FROM `job_ai_triage`/);
 assert.match(secondMigration,/UPDATE `jobs` SET `status` = 'archived'/);
 assert.match(secondMigration,/WHERE `published_at` < 1786752000000/);
 assert.match(lifecycle,/if\(job\.status==="archived"\)continue/);
 assert.match(settings,/EXCLUIR TODAS AS VAGAS/);
 assert.match(settings,/\/api\/admin\/backup/);
 assert.match(settings,/Limpar base de vagas/);
});
