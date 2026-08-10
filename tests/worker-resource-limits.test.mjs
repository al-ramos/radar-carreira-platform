import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("a listagem pagina no D1 antes de enriquecer o fluxo normal", async () => {
  const route = await read("../app/api/jobs/route.ts");
  assert.match(route, /rowsQuery\.limit\(limit\)\.offset\(offset\)/);
  assert.match(route, /MAX_FILTER_CANDIDATES = 400/);
  assert.match(route, /description: ""/);
  assert.match(route, /or\(isNull\(jobs\.seniority\)/);
});

test("a coleta agendada processa apenas uma fonte por chamada", async () => {
  const route = await read("../app/api/cron/collect/route.ts");
  assert.match(route, /const BATCH_SIZE = 1/);
});

test("falha da API não exibe as quatro vagas demonstrativas", async () => {
  const dashboard = await read("../app/Dashboard.tsx");
  assert.match(dashboard, /useState<Job\[]>\(\[\]\)/);
  assert.match(dashboard, /setMode\("unavailable"\)/);
  assert.match(dashboard, /Seus dados continuam salvos/);
});
