import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("somente fontes ATS participam da coleta automática",async()=>{
 const [connectors,manual,scheduled]=await Promise.all([
  readFile(new URL("../lib/connectors.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/admin/collect/route.ts",import.meta.url),"utf8"),
  readFile(new URL("../app/api/cron/collect/route.ts",import.meta.url),"utf8"),
 ]);
 assert.match(connectors,/PULL_PROVIDERS=\["greenhouse","lever","ashby"\]/);
 assert.match(connectors,/if\(!isPullProvider\(provider\)\)throw new Error/);
 assert.match(manual,/filter\(source => source\.enabled && isPullProvider\(source\.provider\)\)/);
 assert.match(scheduled,/filter\(source=>isPullProvider\(source\.provider\)\)/);
});
