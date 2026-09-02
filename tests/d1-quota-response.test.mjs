import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("listagem consolida contagens globais em uma única consulta", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /const summaryQuery = getDb\(\)\.select/);
  assert.match(route, /eligible: sql<number>`sum\(case when/);
  assert.match(route, /emailMissing: sql<number>`sum\(case when/);
  assert.doesNotMatch(route, /emailMissingTotals/);
  assert.doesNotMatch(route, /sourceTotals/);
});

test("cota diária D1 vira resposta acionável e não um 500 genérico", async () => {
  const [quota, jobs, collector] = await Promise.all([
    read("../lib/d1-quota.ts"),
    read("../app/api/jobs/route.ts"),
    read("../app/api/collector/import/[sourceId]/route.ts"),
  ]);
  assert.match(quota, /D1_DAILY_READ_LIMIT/);
  assert.match(quota, /"Retry-After"/);
  assert.match(quota, /status: 429/);
  assert.match(jobs, /d1QuotaResponse\(error\)/);
  assert.match(collector, /return await handlePost\(request, context\)/);
  assert.match(collector, /d1QuotaResponse\(error\)/);
});
