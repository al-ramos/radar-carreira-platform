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
  assert.match(route, /rascunhos pendentes há mais de 24 horas/);
  assert.match(route, /rotina diária está sem atualização há mais de 30 horas/);
  assert.doesNotMatch(route, /fetch\(|GmailApp/);
  assert.match(screen, /Saúde operacional/);
  assert.match(screen, /Sem alertas operacionais/);
  assert.match(styles, /\.triage-operations/);
});
