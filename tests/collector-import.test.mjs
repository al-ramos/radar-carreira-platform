import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read=path=>readFile(new URL(path,import.meta.url),"utf8");

test("endpoint do coletor exige chave dedicada e oferece CORS",async()=>{
 const [route,auth]=await Promise.all([read("../app/api/collector/import/route.ts"),read("../lib/linkedin-collector-auth.ts")]);
 assert.match(route,/authenticateLinkedInCollectorSecret/);
 assert.match(auth,/LINKEDIN_COLLECTOR_SECRET/);
 assert.match(route,/authorization/);
 assert.match(route,/access-control-allow-origin/);
 assert.match(route,/export async function OPTIONS/);
 assert.match(route,/normalizeImportedJobs/);
 assert.match(route,/persistImportedJobs/);
 assert.match(route,/filterImportedJobsByProfile/);
 assert.match(route,/identity\.userId/);
});

test("persistência do coletor reutiliza fingerprint, jobs e auditoria",async()=>{
 const service=await read("../lib/persist-imported-jobs.ts");
 assert.match(service,/fingerprint\(job\)/);
 assert.match(service,/importRuns/);
 assert.match(service,/onConflictDoUpdate/);
 assert.match(service,/JSON\.stringify\(job\.stack/);
});

test("chave da extensão é armazenada somente como hash e aceita teste de conexão",async()=>{
 const [admin,auth,route,ui]=await Promise.all([read("../app/api/admin/linkedin-key/route.ts"),read("../lib/linkedin-collector-auth.ts"),read("../app/api/collector/import/route.ts"),read("../app/LinkedInExtensionSetup.tsx")]);
 assert.match(admin,/hashCollectorSecret\(secret\)/);
 assert.doesNotMatch(admin,/externalRef:secret/);
 assert.match(auth,/linkedin-extension/);
 assert.match(route,/action===\"test\"/);
 assert.match(ui,/Gerar chave/);
 assert.match(ui,/navigator\.clipboard\.writeText/);
});

test("perfil do portal é aplicado antes da persistência do coletor",async()=>{
 const filter=await read("../lib/collector-profile-filter.ts");
 assert.match(filter,/inferTechnologyStack/);
 assert.match(filter,/stackMatchMode===\"any\"/);
 assert.match(filter,/required\.every/);
 const auth=await read("../lib/linkedin-collector-auth.ts");
 assert.match(auth,/userId\?:string/);
 assert.match(auth,/authenticateLinkedInCollectorSecret/);
});
