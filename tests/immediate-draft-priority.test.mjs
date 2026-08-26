import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("rascunhos avulsos ou em fila pedem criação manual imediata sem enviar e-mail", async () => {
  const [queue, cron, connector, workflow, priority, screen] = await Promise.all([
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/api/cron/drafts/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../.github/workflows/quality.yml"),
    read("../lib/gmail-draft-priority.ts"),
    read("../app/TriageReport.tsx"),
  ]);
  assert.match(queue, /requestImmediateDraftCreation\(priorityOutboxIds\)/);
  assert.match(queue, /existing\.status === "failed"/);
  assert.match(queue, /markImmediateDraftFailure\(priorityOutboxIds/);
  assert.match(queue, /const immediateDraft = priorityOutboxIds\.length/);
  assert.doesNotMatch(queue, /triagem desta vaga está desatualizada/);
  assert.match(queue, /requestedJobIds\?\.length === 1/);
  assert.match(cron, /outboxIds\?: string\[\]/);
  assert.match(cron, /inArray\(draftOutbox\.id, requestedOutboxIds\)/);
  assert.match(connector, /function doPost\(event\)/);
  assert.match(connector, /payload\.action === 'prioritizeDrafts'/);
  assert.match(connector, /payload\.action === 'reconcileSent'/);
  assert.match(connector, /criarRascunhosRadar\(\{ outboxIds: payload\.outboxIds \}\)/);
  assert.doesNotMatch(connector.split("function doPost")[1], /GmailApp\.sendEmail/);
  assert.match(priority, /GMAIL_DRAFTS_WEBHOOK_TOKEN/);
  assert.match(workflow, /GMAIL_DRAFTS_WEBHOOK_URL/);
  assert.match(screen, /rascunho\(s\) foi\(ram\) criado\(s\) agora no Gmail/);
  assert.match(screen, /Criação manual indisponível/);
  assert.match(screen, /draftActionStatuses/);
  assert.match(screen, /Gmail acionado; atualize em instantes para confirmar o rascunho/);
  assert.match(screen, /item\.draftStatus === "pending" \? null/);
  assert.match(screen, /Tentar novamente/);
  assert.match(screen, /item\.draftError/);
  assert.match(priority, /markImmediateDraftFailure/);
});
