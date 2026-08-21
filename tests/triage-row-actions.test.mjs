import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("triagem permite ações avulsas por vaga sem contornar os guardrails", async () => {
  const [screen, queue, review, codexQueue, styles] = await Promise.all([
    read("../app/TriageReport.tsx"),
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/api/triage/ai-review/route.ts"),
    read("../app/api/triage/codex-queue/route.ts"),
    read("../app/platform.css"),
  ]);

  assert.match(screen, /selectedHistoryJobIds/);
  assert.match(screen, /Selecionar todas as vagas visíveis/);
  assert.match(screen, /Consultar IA/);
  assert.match(screen, /Preparar rascunhos/);
  assert.match(screen, /draftActionBlocker/);
  assert.match(screen, /LinkedIn não permite rascunho/);
  assert.match(screen, /E-mail válido exigido/);
  assert.match(screen, /queueDrafts\(\[item\.jobId\]\)/);
  assert.match(screen, /openAiPrompt\(\[item\.jobId\]\)/);
  assert.match(queue, /jobIds\?: string\[\]/);
  assert.match(queue, /inArray\(triageHistory\.jobId, requestedJobIds\)/);
  assert.match(queue, /isSafeForDraft/);
  assert.match(review, /requestedJobIds/);
  assert.match(review, /inArray\(jobs\.id, requestedJobIds\)/);
  assert.match(codexQueue, /inArray\(jobs\.id, requestedJobIds\)/);
  assert.match(styles, /triage-selection-actions/);
  assert.match(styles, /triage-row-actions/);
});
