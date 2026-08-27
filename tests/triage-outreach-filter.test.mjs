import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("triagem não mistura rascunho pronto com vagas sem nenhuma ação de contato", async () => {
  const screen = await readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8");
  assert.match(screen, /hasEmailSent/);
  assert.match(screen, /hasDraftReady/);
  assert.match(screen, /hasApplicationStarted/);
  assert.match(screen, /hasApplicationSent/);
  assert.match(screen, /value="email_sent">E-mail enviado/);
  assert.match(screen, /value="application_started">Candidatura iniciada/);
  assert.match(screen, /value="application_sent">Candidatura enviada/);
  assert.match(screen, /value="pending">Sem rascunho, envio ou candidatura/);
  assert.match(screen, /hasDraftReady\(item\) \|\| hasEmailSent\(item\)/);
});
