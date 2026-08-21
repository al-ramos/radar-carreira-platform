import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("backend agenda a triagem e Apps Script só processa rascunhos", async () => {
  const [worker, workflow, route, script] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/gmail-radarvagas.gs", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /"\/api\/triage\/run"/);
  assert.match(worker, /headers\.delete\("x-radar-collector-authenticated"\)/);
  assert.match(workflow, /"trigger":"schedule","batchSize":100,"aiMode":"off"/);
  assert.match(route, /x-radar-collector-authenticated/);
  assert.match(route, /A rotina agendada só pode ser iniciada pelo backend do Radar/);
  assert.match(script, /executarRascunhosPendentesRadar/);
  assert.doesNotMatch(script, /\$\{radarUrl\(\)\}\/api\/triage\/run/);
});
