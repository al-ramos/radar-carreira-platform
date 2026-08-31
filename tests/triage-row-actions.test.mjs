import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("triagem permite ações avulsas por vaga sem contornar os guardrails", async () => {
  const [screen, dashboard, queue, disqualify, review, codexQueue, styles] = await Promise.all([
    read("../app/TriageReport.tsx"),
    read("../app/Dashboard.tsx"),
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/api/triage/disqualify/route.ts"),
    read("../app/api/triage/ai-review/route.ts"),
    read("../app/api/triage/codex-queue/route.ts"),
    read("../app/platform.css"),
  ]);

  assert.match(screen, /selectedHistoryJobIds/);
  assert.match(screen, /Selecionar todas as vagas filtradas/);
  assert.match(screen, /Consultar contatos já cadastrados/);
  assert.match(screen, /Consultar IA/);
  assert.match(screen, /Abrir candidaturas/);
  assert.match(screen, /Candidatar/);
  assert.match(screen, /openSelectedApplications/);
  assert.match(screen, /\/api\/triage\/applications\/open/);
  assert.match(screen, /Preparar rascunhos/);
  assert.match(screen, /Desclassificar/);
  assert.match(screen, /disqualifySelectedJobs/);
  assert.match(screen, /Desclassificar selecionadas/);
  assert.match(screen, /jobIds: jobsToDisqualify\.map/);
  assert.match(screen, /\/api\/triage\/disqualify/);
  assert.match(screen, /draftActionBlocker/);
  assert.match(screen, /LinkedIn não permite rascunho/);
  assert.match(screen, /E-mail válido exigido/);
  assert.match(screen, /queueDrafts\(\[item\.jobId\]\)/);
  assert.match(screen, /A triagem estava desatualizada; reavaliando esta vaga/);
  assert.match(screen, /api\/jobs\/\$\{encodeURIComponent\(jobIds\[0\]\)\}\/analysis/);
  assert.match(screen, /result\.outdated > 0/);
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
  assert.match(queue, /if \(!isSafeForDraft\(\{ verdict: row\.analysis\.verdict/);
  assert.match(disqualify, /verdict: "❌"/);
  assert.match(disqualify, /jobIds\?: string\[\]/);
  assert.match(disqualify, /inArray\(userJobAnalyses\.jobId, jobIds\)/);
  assert.match(disqualify, /Desclassifique no máximo 100 vagas por vez/);
  assert.match(disqualify, /Desclassificada manualmente/);
  assert.match(disqualify, /eq\(draftOutbox\.status, "pending"\)/);
  assert.match(review, /requestedJobIds/);
  assert.match(review, /inArray\(jobs\.id, requestedJobIds\)/);
  assert.match(codexQueue, /inArray\(jobs\.id, requestedJobIds\)/);
  assert.match(dashboard, /pendingTriageJobIdRef/);
  assert.match(dashboard, /openJobInRadar=\{\(job\)/);
  assert.match(dashboard, /\[triageMounted, setTriageMounted\]/);
  assert.match(dashboard, /if \(n === "Radar"\) setTriageOpen\(false\)/);
  assert.match(dashboard, /open=\{triageOpen\}/);
  assert.match(dashboard, /setQuery\(job\.externalId \?\? job\.jobId\)/);
  assert.match(dashboard, /setFocusedJobId\(job\.jobId\)/, "o link da triagem deve usar o identificador exato da vaga");
  assert.match(dashboard, /setSourceFilter\("all"\)/, "o atalho não pode falhar por uma fonte que mudou depois da coleta");
  assert.match(dashboard, /setReviewVisibility\("all"\)/, "o link da triagem precisa incluir candidaturas já iniciadas");
  assert.match(dashboard, /\$\{j\.id\} \$\{j\.externalId \?\? ""\}/);
  assert.match(await read("../app/api/jobs/route.ts"), /eq\(jobs\.id, searchQuery\)/);
  assert.match(styles, /triage-selection-actions/);
  assert.match(styles, /triage-row-actions/);
  assert.match(styles, /triage-job-link/);
});
