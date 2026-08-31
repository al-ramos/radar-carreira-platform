import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// Incidente do lote 8617af56 (21/08/2026): quando a idempotência reaproveita
// um resultado já existente, o item do lote era marcado "completed" mas
// user_job_analyses — a tabela que a tela de Histórico lê — nunca era
// atualizada. A vaga ficava com veredito salvo em triage_history, porém
// invisível na tela. Este teste garante que o caminho de reaproveitamento
// sempre grava também em user_job_analyses.
test("reaproveitamento por idempotência também atualiza user_job_analyses", async () => {
  const route = await readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8");
  const reuseBranchStart = route.indexOf('claimed?.status === "completed" && !run.reprocess && !retryAi');
  assert.notEqual(reuseBranchStart, -1, "o caminho de reaproveitamento por idempotência deve existir");
  const nextContinueIndex = route.indexOf("continue;", reuseBranchStart);
  assert.notEqual(nextContinueIndex, -1);
  const reuseBranch = route.slice(reuseBranchStart, nextContinueIndex);
  assert.match(route, /triageHistory\)\.where\(eq\(triageHistory\.id, claimed\.historyId\)\)/, "deve buscar o histórico reaproveitado");
  assert.match(reuseBranch, /db\.insert\(userJobAnalyses\)/, "deve upsertar user_job_analyses no caminho de reaproveitamento");
  assert.match(reuseBranch, /target: \[userJobAnalyses\.userId, userJobAnalyses\.jobId\]/, "o upsert deve usar a chave (userId, jobId)");
  assert.match(route, /db\.delete\(triageDeduplication\)/, "chaves concluídas sem histórico devem permitir uma nova avaliação");
  assert.match(route, /eq\(userJobAnalyses\.rulesRevision, versions\.rulesRevision\)/, "uma regra nova precisa tornar a análise anterior elegível à reavaliação");
});
