import assert from "node:assert/strict";
import test from "node:test";
import { APINFO_SOURCE_ID, LINKEDIN_SOURCE_ID, OTHER_SOURCE_ID, inferJobSourceId, jobSourceLabel } from "../lib/job-source.ts";

test("atribui uma fonte padrão a qualquer URL importada",()=>{
 assert.equal(inferJobSourceId("https://www.linkedin.com/jobs/view/123"),LINKEDIN_SOURCE_ID);
 assert.equal(inferJobSourceId("https://www.apinfo.com/apinfo/inc/list/vagas.jsp?cod=123"),APINFO_SOURCE_ID);
 assert.equal(inferJobSourceId("https://empresa.example/carreiras/123"),OTHER_SOURCE_ID);
});

test("normaliza a fonte declarada no arquivo e apresenta o rótulo genérico",()=>{
 assert.equal(inferJobSourceId("https://empresa.example", "LinkedIn"),LINKEDIN_SOURCE_ID);
 assert.equal(inferJobSourceId("https://empresa.example", "APInfo"),APINFO_SOURCE_ID);
 assert.equal(jobSourceLabel(OTHER_SOURCE_ID),"Outras fontes");
});
