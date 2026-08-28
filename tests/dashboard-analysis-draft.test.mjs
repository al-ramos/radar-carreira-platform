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

test("Radar recupera automaticamente aprovações antigas que ainda não têm rascunho", async () => {
  const dashboard = await readFile(new URL("../app/Dashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /approvedDraftRecoveryRequestedRef/);
  assert.match(dashboard, /fetch\("\/api\/triage\/drafts\/queue"/);
  assert.match(dashboard, /JSON\.stringify\(\{ homePeriod: "all" \}\)/);
  assert.match(dashboard, /Aprovações anteriores foram colocadas na fila de rascunho/);
  assert.match(dashboard, /nunca de envio/);
});
