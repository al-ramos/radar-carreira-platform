import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("somente fontes ATS participam da coleta automática",async()=>{
 const [connectors,schema,migration,manual,scheduled]=await Promise.all([
  readFile(new URL("../lib/connectors.ts",import.meta.url),"utf8"),
  readFile(new URL("../db/schema.ts",import.meta.url),"utf8"),
  readFile(new URL("../drizzle/0005_source_ingestion_mode.sql",import.meta.url),"utf8"),
  readFile(new URL("../app/api/admin/collect/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/cron/collect/route.ts",import.meta.url),"utf8"),
 ]);
 assert.match(connectors,/PULL_PROVIDERS=\["greenhouse","lever","ashby"\]/);
 assert.match(connectors,/if\(!isPullProvider\(provider\)\)throw new Error/);
 assert.match(schema,/collectionMode: text\("collection_mode", \{ enum: \["pull", "push"\] \}\)\.notNull\(\)\.default\("push"\)/);
 assert.match(migration,/UPDATE `job_sources` SET `collection_mode` = 'pull' WHERE `provider` IN \('greenhouse', 'lever', 'ashby'\)/);
 assert.match(manual,/source\.collectionMode === "pull" && isPullProvider\(source\.provider\)/);
 assert.match(scheduled,/source\.collectionMode==="pull"&&isPullProvider\(source\.provider\)/);
});
