import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("histórico expõe saúde operacional sem executar triagem ou Gmail", async () => {
  const [route, screen, styles] = await Promise.all([
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform.css", import.meta.url), "utf8"),
  ]);

  assert.match(route, /operational:/);
  assert.match(route, /oldestPendingAt/);
  assert.match(route, /draftSubject/);
  assert.match(route, /triageBatchItems/);
  assert.match(route, /batchDraftRows/);
  assert.match(route, /latestScheduled/);
  assert.match(route, /STALE_DRAFT_AFTER_MS/);
  assert.match(route, /rascunhos pendentes há mais de 24 horas/);
  assert.match(route, /triagem automática não executa há mais de 30 horas/);
  assert.doesNotMatch(route, /fetch\(|GmailApp/);
  assert.match(screen, /Rascunhos de candidatura/);
  assert.match(screen, /prontos para revisar/);
  assert.match(screen, /const scopedHistory/);
  assert.match(screen, /const draftCounts/);
  assert.match(screen, /draftCounts\.drafted/);
  assert.match(screen, /openHistory\("drafted"\)/);
  assert.match(screen, /<details className="triage-actions">/);
  assert.match(screen, /Exibir ações de automação/);
  assert.match(screen, /triage-pagination/);
  assert.match(screen, /de \{filteredHistory\.length\} vagas/);
  assert.match(screen, /Automação e rascunhos em dia/);
  assert.match(styles, /\.triage-operations/);
});
