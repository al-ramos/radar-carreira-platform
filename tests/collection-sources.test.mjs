import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("somente fontes ATS participam da coleta automática",async()=>{
 const [connectors,parser,schema,migration,manual,scheduled,sourceList,dashboard]=await Promise.all([
  readFile(new URL("../lib/connectors.ts",import.meta.url),"utf8"),
  readFile(new URL("../lib/career-source.ts",import.meta.url),"utf8"),
  readFile(new URL("../db/schema.ts",import.meta.url),"utf8"),
  readFile(new URL("../drizzle/0005_source_ingestion_mode.sql",import.meta.url),"utf8"),
  readFile(new URL("../app/api/admin/collect/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/cron/collect/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/SourceList.tsx",import.meta.url),"utf8"),
  readFile(new URL("../app/Dashboard.tsx",import.meta.url),"utf8"),
 ]);
 assert.match(connectors,/PULL_PROVIDERS=\["greenhouse","lever","ashby"\]/);
 assert.match(parser,/boards\.greenhouse\.io/);
 assert.match(parser,/jobs\.lever\.co/);
 assert.match(parser,/jobs\.ashbyhq\.com/);
 assert.match(connectors,/if\(!isPullProvider\(provider\)\)throw new Error/);
 assert.match(schema,/collectionMode: text\("collection_mode", \{ enum: \["pull", "push"\] \}\)\.notNull\(\)\.default\("push"\)/);
 assert.match(migration,/UPDATE `job_sources` SET `collection_mode` = 'pull' WHERE `provider` IN \('greenhouse', 'lever', 'ashby'\)/);
 assert.match(manual,/source\.collectionMode === "pull" && isPullProvider\(source\.provider\)/);
 assert.match(scheduled,/source\.collectionMode\s*===\s*"pull"\s*&&\s*isPullProvider\(source\.provider\)/);
 assert.match(sourceList,/Empresas cadastradas/);
 assert.match(sourceList,/Integrações de entrada/);
 assert.match(dashboard,/Coletar todas/);
 assert.match(dashboard,/onCollectAll=\{\(\) => collectNow\(\)\}/);
 assert.match(sourceList,/onClick=\{\(\) => void collectAll\(\)\}/);
 assert.match(dashboard,/collectionResults/);
 assert.match(dashboard,/data\.outcomes/);
 assert.match(dashboard,/Adicionar nova empresa/);
 assert.match(dashboard,/Salvar e testar/);
});
