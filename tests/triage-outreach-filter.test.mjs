import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("filtro de envio reúne e-mail enviado e rascunho pronto, sem separar o rascunho em outro campo", async () => {
  const screen = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");
  assert.match(screen, /hasEmailSent/);
  assert.match(screen, /hasDraftReady/);
  assert.match(screen, /hasApplicationStarted/);
  assert.match(screen, /hasApplicationSent/);
  assert.match(screen, /value="email_sent">E-mail enviado ou rascunho pronto/);
  assert.match(screen, /value="draft_pending">Rascunho na fila/);
  assert.match(screen, /value="draft_failed">Rascunho com falha/);
  assert.match(screen, /value="application_started">Candidatura iniciada/);
  assert.match(screen, /value="application_sent">Candidatura enviada/);
  assert.match(screen, /value="pending">Sem rascunho, envio ou candidatura/);
  assert.match(screen, /hasEmailSent\(item\) \|\| hasDraftReady\(item\)/);
  assert.match(screen, /hasEmailOrDraftReady/);
  assert.doesNotMatch(screen, /<label>Rascunho<select/);
  assert.match(screen, /clearHistoryFilters/);
  assert.match(screen, /setJobSourceFilter\("all"\)/);
  assert.match(screen, /Limpar outros filtros/);
  assert.match(screen, /Não há vagas sem veredito no momento/);
});
