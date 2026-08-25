import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeImportedJobs, normalizeImportedJobsWithDiagnostics } from "../lib/import-jobs.ts";

test("normaliza o JSON gerado pelo LinkedIn Job Collector",()=>{
 const [job]=normalizeImportedJobs([{titulo:"Security Engineer",empresa:"Empresa",local:"São Paulo, Brasil · há 14 minutos · 10 candidaturas",descricao:"Modelo de trabalho híbrido",link:"https://www.linkedin.com/jobs/view/4449682834/",coletado_em:"2026-08-05T19:15:40.844Z",pagina:1}]);
 assert.deepEqual(job,{company:"Empresa",title:"Security Engineer",url:"https://www.linkedin.com/jobs/view/4449682834/",description:"Modelo de trabalho híbrido",location:"São Paulo, Brasil",workMode:"Híbrido",seniority:undefined,stack:undefined,publishedAt:undefined,externalId:"4449682834",applyUrl:undefined,contactEmail:undefined,contactSubject:undefined,sourceId:undefined});
});

test("mantém a publicação informada pela fonte separada da coleta",()=>{
 const [job]=normalizeImportedJobs([{titulo:"Analista",empresa:"Empresa",link:"https://www.apinfo.com/vaga/85321",data_publicacao:"13/08/26",coletado_em:"2026-08-13T18:42:00.000Z"}]);
 assert.equal(job.publishedAt,"13/08/26");
});

test("explica quais dados obrigatórios impediram a entrada no Radar",()=>{
 const result=normalizeImportedJobsWithDiagnostics([{titulo:"Sem link",empresa:"Empresa"},{titulo:"Sem empresa",link:"https://example.com/vaga"},{titulo:"Válida",empresa:"Empresa",link:"https://example.com/valida"}]);
 assert.equal(result.items.length,1);
 assert.equal(result.rejected,2);
 assert.deepEqual(result.reasons,{"link da vaga ausente":1,"empresa ausente":1});
});

test("endpoint da extensão LinkedIn responde ao preflight CORS", async()=>{
 const source=await readFile(new URL("../proxy.ts",import.meta.url),"utf8");
 assert.match(source,/access-control-allow-origin/);
 assert.match(source,/access-control-allow-headers/);
 assert.match(source,/request\.method === "OPTIONS"/);
});

test("importação da extensão processa vagas em lotes e registra o progresso", async()=>{
 const source=await readFile(new URL("../app/api/collector/import/route.ts",import.meta.url),"utf8");
 assert.match(source,/WRITE_BATCH_SIZE = 50/);
 assert.match(source,/LOOKUP_BATCH_SIZE = 100/);
 assert.match(source,/await db\.batch\(/);
 assert.match(source,/status: "failed"/);
 assert.match(source,/duplicates: duplicateRows/);
 assert.match(source,/filterImportedJobsByProfile/);
 assert.match(source,/rejected: filtered\.rejected/);
});

test("coleta das fontes do sistema filtra pelo perfil antes de gravar vagas", async()=>{
 const source=await readFile(new URL("../app/api/cron/collect/route.ts",import.meta.url),"utf8");
 assert.match(source,/filterImportedJobsByProfile\(found/);
 assert.match(source,/requiredStacks: careerRules\.coreStack/);
 assert.match(source,/filtered\.accepted\.map/);
 assert.match(source,/rejectedProfile: filtered\.rejected/);
 assert.match(source,/APInfo, RadarVagas e LinkedIn já chegam/);
});

test("coletores registram início, conclusão e falha no monitoramento", async()=>{
 const [route,monitor,ui]=await Promise.all([
  readFile(new URL("../app/api/collector/import/[sourceId]/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/admin/monitor/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/Monitoring.tsx",import.meta.url),"utf8"),
 ]);
 assert.match(route,/payload\?\.action === "status"/);
 assert.match(route,/recordCollectorStatus/);
 assert.match(route,/onConflictDoUpdate/);
 assert.match(route,/lastAttemptAt: now/);
 assert.match(route,/lastSuccessAt: now/);
 assert.match(route,/consecutiveFailures: source\.consecutiveFailures \+ 1/);
 assert.match(route,/collectorRunId\(payload\?\.runId\)/);
 assert.match(monitor,/sources\.filter\(\(source\) => source\.enabled && source\.lastError\)/);
 assert.match(ui,/última execução/);
 assert.match(ui,/operation\.completed.*operation\.total.*operation\.failed/);
});

test("monitoramento consolida importações e lotes de triagem sem expor o detalhe bruto", async()=>{
 const [monitor,ui]=await Promise.all([
  readFile(new URL("../app/api/admin/monitor/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/Monitoring.tsx",import.meta.url),"utf8"),
 ]);
 assert.match(monitor,/triageBatches/);
 assert.match(monitor,/triageBatchItems/);
 assert.match(monitor,/safeError/);
 assert.match(monitor,/operations/);
 assert.match(ui,/CENTRO OPERACIONAL/);
 assert.ok(ui.includes('<option value="all">Todos</option>'));
 assert.match(ui,/Precisa de atenção/);
});

test("rotas convertem Date para epoch antes de interpolar sourcePublishedAt no SQL do D1", async()=>{
 const files=[
  "../app/api/collector/import/route.ts",
  "../app/api/collector/import/[sourceId]/route.ts",
  "../app/api/admin/import/route.ts",
  "../app/api/admin/collect/route.ts",
  "../app/api/cron/collect/route.ts",
 ];
 for(const file of files){
  const source=await readFile(new URL(file,import.meta.url),"utf8");
  assert.doesNotMatch(source,/coalesce\(\$\{values\.sourcePublishedAt\},/);
  assert.match(source,/coalesce\(\$\{values\.sourcePublishedAt\?\.getTime\(\) \?\? null\},/);
 }
});

test("falhas de importação preservam o detalhe técnico na notificação", async()=>{
 const routes=await Promise.all([
  readFile(new URL("../app/api/collector/import/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/collector/import/[sourceId]/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/admin/import/route.ts",import.meta.url),"utf8"),
 ]);
 for(const route of routes){
  assert.match(route,/catch \(error\)/);
  assert.match(route,/error: detail\.slice\(0, 300\)/);
 }
});

test("importação manual usa lotes e pode reenviar o mesmo arquivo", async()=>{
 const source=await readFile(new URL("../app/api/admin/import/route.ts",import.meta.url),"utf8");
 assert.match(source,/WRITE_BATCH_SIZE = 50/);
 assert.match(source,/LOOKUP_BATCH_SIZE = 100/);
 assert.match(source,/await db\.batch\(/);
 assert.match(source,/duplicates: duplicateRows/);
 assert.match(source,/status: "failed"/);
});
