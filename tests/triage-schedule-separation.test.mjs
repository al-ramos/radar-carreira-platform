import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("importação de extensão inicia a triagem agendada pela fila e preserva a separação da coleta normal", async () => {
  const [worker, workflow, route, script] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/gmail-radarvagas.gs", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /"\/api\/triage\/run"/);
  assert.match(worker, /headers\.delete\("x-radar-collector-authenticated"\)/);
  assert.match(worker, /kind: "scheduled-triage"/);
  assert.match(worker, /continuation: payload\.continuation \+ 1/);
  assert.match(worker, /aiMode: "off"/);
  assert.doesNotMatch(workflow, /"trigger":"schedule"/);
  assert.match(route, /x-radar-collector-authenticated/);
  assert.match(route, /A rotina agendada só pode ser iniciada pelo backend do Radar/);
  assert.match(script, /executarRascunhosPendentesRadar/);
  assert.doesNotMatch(script, /\$\{radarUrl\(\)\}\/api\/triage\/run/);
});
