import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("aprovação registrada no Radar cria rascunho imediatamente", async () => {
  const route = await readFile(new URL("../app/api/jobs/[id]/analysis/route.ts", import.meta.url), "utf8");
  assert.match(route, /async function queueApprovedDraft/);
  assert.match(route, /isSafeForDraft/);
  assert.match(route, /db\.insert\(draftOutbox\)\.values/);
  assert.match(route, /requestImmediateDraftCreation\(\[outboxId\]\)/);
  assert.match(route, /markImmediateDraftFailure\(\[outboxId\], immediate\.reason\)/);
  assert.match(route, /const draft = await queueApprovedDraft/);
});

test("aprovações antigas exigem ação explícita e não varrem o D1 ao abrir o Radar", async () => {
  const [dashboard, triage] = await Promise.all([
    readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(dashboard, /approvedDraftRecoveryRequestedRef/);
  assert.doesNotMatch(dashboard, /JSON\.stringify\(\{ homePeriod: "all" \}\)/);
  assert.match(triage, /Enviar candidaturas selecionadas/);
  assert.match(triage, /onClick=\{\(\) => void queueDrafts/);
});
