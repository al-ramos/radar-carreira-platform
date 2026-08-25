import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("triagem permite ações avulsas por vaga sem contornar os guardrails", async () => {
  const [screen, dashboard, queue, review, codexQueue, styles] = await Promise.all([
    read("../app/TriageReport.tsx"),
    read("../app/Dashboard.tsx"),
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
  assert.match(screen, /requestAiReview\(\[item\.jobId\]\)/);
  assert.match(screen, /prepareCodexReview\(\[item\.jobId\]\)/);
  assert.match(screen, /\/api\/triage\/codex-queue\?state=all/);
  assert.match(screen, /Preparado; aguardando seu pedido no Codex/);
  assert.match(screen, /Copiar pedido/);
  assert.match(screen, /Na fila da IA; atualiza automaticamente/);
  assert.match(screen, /openJobInRadar\(item\)/);
  assert.match(screen, /triage-job-link/);
  assert.match(screen, /Analisa esta vaga agora no portal/);
  assert.match(screen, /não inicia uma análise automática/);
  assert.match(screen, /actions\.open = true/);
  assert.match(screen, /aiPromptRef\.current\?\.scrollIntoView/);
  assert.match(screen, /ref=\{aiPromptRef\}/);
  assert.match(screen, /readJsonResponse/);
  assert.match(screen, /não recebeu resposta do serviço/);
  assert.match(screen, /A solicitação de análise/);
  assert.match(queue, /jobIds\?: string\[\]/);
  assert.match(queue, /inArray\(userJobAnalyses\.jobId, requestedJobIds\)/);
  assert.match(queue, /draft-history-repair/);
  assert.match(queue, /isSafeForDraft/);
  assert.match(review, /requestedJobIds/);
  assert.match(review, /inArray\(jobs\.id, requestedJobIds\)/);
  assert.match(codexQueue, /inArray\(jobs\.id, requestedJobIds\)/);
  assert.match(dashboard, /pendingTriageJobIdRef/);
  assert.match(dashboard, /openJobInRadar=\{\(job\)/);
  assert.match(dashboard, /\[triageMounted, setTriageMounted\]/);
  assert.match(dashboard, /if \(n === "Radar"\) setTriageOpen\(false\)/);
  assert.match(dashboard, /open=\{triageOpen\}/);
  assert.match(dashboard, /setQuery\(job\.externalId \?\? job\.jobId\)/);
  assert.match(dashboard, /setSourceFilter\(job\.jobSource \?\? "all"\)/);
  assert.match(dashboard, /\$\{j\.id\} \$\{j\.externalId \?\? ""\}/);
  assert.match(await read("../app/api/jobs/route.ts"), /eq\(jobs\.id, searchQuery\)/);
  assert.match(styles, /triage-selection-actions/);
  assert.match(styles, /triage-row-actions/);
  assert.match(styles, /triage-job-link/);
});
