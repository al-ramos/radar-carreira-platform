import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("acionamento manual respeita os filtros ativos da Home", async () => {
  const [route, asyncRoute, ui, preview, queue, cron, worker, aiReview, codexQueue] = await Promise.all([
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/preview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/drafts/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cron/drafts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/ai-review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/codex-queue/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /run\.dateScope === "received" \? jobs\.firstSeenAt : jobs\.publishedAt/);
  assert.match(route, /run\.roleArea \? eq\(jobs\.roleArea, run\.roleArea\)/);
  assert.match(route, /run\.ingestionChannel \? eq\(jobs\.ingestionChannel, run\.ingestionChannel\)/);
  assert.match(ui, /fetch\("\/api\/triage\/queue"/);
  assert.match(ui, /sourceId: actionSourceId, dateScope: "received", homePeriod: actionPeriod, roleArea: actionArea, ingestionChannel: actionChannel/);
  assert.match(asyncRoute, /TRIAGE_QUEUE/);
  assert.match(asyncRoute, /MANUAL_TRIAGE_BATCH_SIZE = 100/);
  assert.match(ui, /Math\.min\(actionCandidateCount, 100\)/);
  assert.match(ui, /retornou uma página de erro do servidor/);
  assert.match(asyncRoute, /triageBatchItems/);
  assert.match(asyncRoute, /type QueueMessage = \{ body: QueuePayload \}/);
  assert.match(asyncRoute, /\{ body: \{ userId: user\.userId, batchId, jobId, run \} \}/);
  assert.match(worker, /async queue\(/);
  assert.match(worker, /x-radar-triage-queue-authenticated/);
  assert.match(ui, /Fonte das vagas a analisar/);
  assert.match(ui, /<option value="all">Todas as fontes<\/option>/);
  assert.match(ui, /useState\(sourceId \?\? "all"\)/);
  assert.match(ui, /Incluir vagas já triadas/);
  assert.match(ui, /Período das vagas a analisar/);
  assert.match(ui, /Consulta à IA/);
  assert.match(ui, /\/api\/triage\/ai-review/);
  assert.match(ui, /Perfil e stack que a IA vai usar/);
  assert.match(ui, /fetch\("\/api\/profile"\)/);
  assert.match(ui, /masteredSkills/);
  assert.match(ui, /Projeto ou experiência-âncora/);
  assert.match(ui, /Restrições/);
  assert.match(preview, /eq\(jobs\.sourceId, sourceId\)/);
  assert.match(preview, /sourceId === "all" \? undefined/);
  assert.match(aiReview, /sourceId === "all" \? undefined/);
  assert.match(codexQueue, /sourceId === "all" \? undefined/);
  assert.match(preview, /gte\(jobs\.firstSeenAt, cutoff\)/);
  assert.match(preview, /count\(userJobAnalyses\.jobId\)/);
  assert.match(queue, /isDraftAllowedForSource\(\{ sourceId: row\.job\.sourceId/);
  assert.match(queue, /gte\(jobs\.firstSeenAt, cutoff\)/);
  assert.match(ui, /homePeriod: actionPeriod/);
  assert.match(ui, /Fila preparada para este recorte/);
  assert.match(cron, /isDraftAllowedForSource\(\{ sourceId: row\.sourceId/);
});

test("painel inicia a fila para recortes grandes sem bloquear a ação manual", async () => {
  const [ui, orchestrator] = await Promise.all([
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/triage-orchestrator.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(ui, /MAX_MANUAL_TRIAGE_JOBS/);
  assert.match(ui, /processado em segundo plano/);
  assert.match(orchestrator, /MAX_ASYNC_TRIAGE_JOBS = 1000/);
  assert.match(ui, /consulta à IA será processada em segundo plano/);
  assert.doesNotMatch(ui, /MAX_AI_REVIEW_JOBS/);
  assert.match(ui, /Triar por regras/);
});

test("a tela explica a ordem das ações e acompanha o último lote manual", async () => {
  const ui = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");
  assert.match(ui, /Triar por regras/);
  assert.match(ui, /Use após a etapa 1 concluir/);
  assert.match(ui, /SEU ÚLTIMO LOTE/);
  assert.match(ui, /Sincronizar agora/);
  assert.match(ui, /manualIsActive/);
  assert.match(ui, /Sincronização automática a cada 4 segundos/);
  assert.match(ui, /Ver log do lote/);
});
