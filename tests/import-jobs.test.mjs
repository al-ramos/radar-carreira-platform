import assert from "node:assert/strict";
import test from "node:test";
import { normalizeImportedJobs } from "../lib/import-jobs.ts";

test("normaliza o JSON gerado pelo LinkedIn Job Collector",()=>{
 const [job]=normalizeImportedJobs([{titulo:"Security Engineer",empresa:"Empresa",local:"São Paulo, Brasil · há 14 minutos · 10 candidaturas",descricao:"Modelo de trabalho híbrido",link:"https://www.linkedin.com/jobs/view/4449682834/",coletado_em:"2026-08-05T19:15:40.844Z",pagina:1}]);
 assert.deepEqual(job,{company:"Empresa",title:"Security Engineer",url:"https://www.linkedin.com/jobs/view/4449682834/",description:"Modelo de trabalho híbrido",location:"São Paulo, Brasil",workMode:"Híbrido",seniority:undefined,stack:undefined,publishedAt:"2026-08-05T19:15:40.844Z",externalId:"4449682834",sourceId:undefined});
});
