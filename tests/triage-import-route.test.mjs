import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("reimportação de análise externa substitui veredito, gera rascunho quando seguro e é restrita ao proprietário", async () => {
  const route = await readFile(new URL("../app/api/admin/triage-import/route.ts", import.meta.url), "utf8");
  assert.match(route, /isOwnerEmail\(user\.email\)/, "só o proprietário pode importar");
  assert.match(route, /source: "ai"/, "veredito importado é registrado com origem 'ai'");
  assert.match(route, /matches\.length > 1.*ambiguous\.push/s, "código ambíguo (mais de uma vaga) não deve ser aplicado às cegas");
  assert.match(route, /isSafeForDraft\(/, "reaproveita a mesma checagem de segurança do fluxo normal antes de enfileirar rascunho");
  assert.match(route, /db\.insert\(draftOutbox\)/, "veredito aprovado pode entrar na fila de rascunho, como um veredito normal");
  assert.match(route, /requestImmediateDraftCreation\(pendingOutboxIds\)/, "uma aprovação CSV segura aciona o Gmail imediatamente");
  assert.match(route, /markImmediateDraftFailure/, "uma indisponibilidade do Gmail fica registrada como falha acionável, sem aguardar fila");
  assert.match(route, /db\.insert\(triageHistory\)/, "preserva o histórico aditivo");
  assert.match(route, /trigger: "manual", scope: "csv-import"/, "fica auditável como um lote");
  assert.match(route, /finalRowsByExternalId/, "quando o CSV repetir um código, aplica a conclusão da última linha");
});
