import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("endpoint do coletor exige chave dedicada e oferece CORS",async()=>{
 const route=await read("../app/api/collector/import/route.ts");
 assert.match(route,/LINKEDIN_COLLECTOR_SECRET/);
 assert.match(route,/authorization/);
 assert.match(route,/access-control-allow-origin/);
 assert.match(route,/export async function OPTIONS/);
 assert.match(route,/normalizeImportedJobs/);
 assert.match(route,/persistImportedJobs/);
});

test("persistência do coletor reutiliza fingerprint, jobs e auditoria",async()=>{
 const service=await read("../lib/persist-imported-jobs.ts");
 assert.match(service,/fingerprint\(job\)/);
 assert.match(service,/importRuns/);
 assert.match(service,/onConflictDoUpdate/);
 assert.match(service,/JSON\.stringify\(job\.stack/);
});
