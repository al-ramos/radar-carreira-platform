import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("toda importação inicia a triagem agendada pela fila e preserva a separação da coleta normal", async () => {
  const [worker, workflow, route, script, collectRoute] = await Promise.all([
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/collect.yml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/gmail-radarvagas.gs", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/collect/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(worker, /"\/api\/triage\/run"/);
  assert.match(worker, /headers\.delete\("x-radar-collector-authenticated"\)/);
  assert.match(worker, /kind: "scheduled-triage"/);
  assert.doesNotMatch(worker, /knownPushSourceIds/);
  assert.match(worker, /homePeriod: "all"/);
  assert.match(worker, /\/api\/cron\/collect/);
  assert.match(worker, /if \(typeof outcome\.id === "string"\) sourceIds\.add\(outcome\.id\)/);
  assert.match(worker, /\/api\/cron\/email-import/);
  assert.match(worker, /\/api\/admin\/collect/);
  assert.match(collectRoute, /outcomes\.push\(\{ id: source\.id, inserted: sourceInserted, updated: sourceUpdated \}\)/);
  assert.match(collectRoute, /\r?\n    outcomes,\r?\n    nextOffset:/);
  assert.match(worker, /continuation: payload\.continuation \+ 1/);
  assert.match(worker, /aiMode: "off"/);
  assert.match(workflow, /Falha transitória ao coletar a fonte no offset/);
  assert.match(route, /x-radar-collector-authenticated/);
  assert.match(route, /x-radar-triage-user-id/);
  assert.match(route, /A rotina agendada só pode ser iniciada pelo backend do Radar/);
  assert.match(script, /executarRascunhosPendentesRadar/);
  assert.doesNotMatch(script, /\$\{radarUrl\(\)\}\/api\/triage\/run/);
});
