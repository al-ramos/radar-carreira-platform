import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

// A pessoa usuária pediu para acionar pelo portal a mesma varredura de
// "Enviados" que o Apps Script já faz sozinho em segundo plano — sem
// precisar escolher vaga por vaga. O conector (public/gmail-radarvagas.gs)
// já aceita um lote de outboxIds; este teste garante que a rota do portal
// também passa a aceitar lote, em vez de recusar tudo que não for exatamente
// uma vaga.
test("reconciliação de envio funciona em lote (todos os pendentes ou uma seleção), não só vaga a vaga", async () => {
  const [queue, connector, screen] = await Promise.all([
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../public/gmail-radarvagas.gs"),
    read("../app/TriageReport.tsx"),
  ]);
  const reconcileBranchStart = queue.indexOf('body.action === "reconcileSent"');
  assert.notEqual(reconcileBranchStart, -1);
  const nextActionIndex = queue.indexOf("if (body.action ===", reconcileBranchStart + 10);
  const reconcileBranch = queue.slice(reconcileBranchStart, nextActionIndex === -1 ? undefined : nextActionIndex);

  assert.match(reconcileBranch, /if \(!requestedJobIds\.length\)/, "sem jobIds deve varrer todos os rascunhos pendentes do usuário");
  assert.match(reconcileBranch, /eq\(draftOutbox\.status, "drafted"\)/, "só considera rascunhos ainda não confirmados");
  assert.match(reconcileBranch, /inArray\(draftOutbox\.jobId, requestedJobIds\)/, "aceita uma seleção de várias vagas de uma vez");
  assert.match(reconcileBranch, /requestImmediateSentReconciliation\(pending\.map/, "aciona o conector com o lote completo");

  // O conector já suporta lote de outboxIds — a mudança do portal não pode
  // depender de algo que o Apps Script não aceite.
  assert.match(connector, /reconciliarEnviosManuaisRadar\(\{ outboxIds: payload\.outboxIds \}\)/);

  assert.match(screen, /reconcileAllSentDrafts/, "existe um acionador único na tela, não só por vaga");
  assert.match(screen, /draftCounts\.drafted > 0 &&/, "o botão só aparece quando há algo pendente de confirmar");
});
