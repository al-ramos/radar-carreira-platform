import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("coleta agendada não inicia triagem; vereditos dependem da ação manual no portal", async () => {
  const [worker, workflow, route, script] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/gmail-radarvagas.gs", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /"\/api\/triage\/run"/);
  assert.match(worker, /headers\.delete\("x-radar-collector-authenticated"\)/);
  assert.doesNotMatch(workflow, /"trigger":"schedule"/);
  assert.match(route, /x-radar-collector-authenticated/);
  assert.match(route, /A rotina agendada só pode ser iniciada pelo backend do Radar/);
  assert.match(script, /executarRascunhosPendentesRadar/);
  assert.doesNotMatch(script, /\$\{radarUrl\(\)\}\/api\/triage\/run/);
});
