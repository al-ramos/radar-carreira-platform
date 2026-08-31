import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("expõe observabilidade acionável da triagem no painel", async () => {
  const [route, health, screen, styles, worker] = await Promise.all([
    readFile(new URL("../app/api/triage/queue-usage/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/triage-observability.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/platform.css", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /pendingCurrentVersion/);
  assert.match(route, /lastImport:/);
  assert.match(route, /lastTriage:/);
  assert.match(health, /nextExecutionAt/);
  assert.match(route, /triage-dispatch/);
  assert.match(health, /queueOperationCount/);
  assert.match(health, /America\/Sao_Paulo/);
  assert.match(health, /status: TriageObservabilityStatus/);
  assert.match(screen, /OBSERVABILIDADE/);
  assert.match(screen, /Pendentes nas regras atuais/);
  assert.match(screen, /Próxima execução/);
  assert.match(screen, /O que está acontecendo/);
  assert.match(styles, /\.triage-observability\.blocked/);

  // O cron observa pendências, mas não cria um fan-out automático de fontes.
  const monitorStart = worker.indexOf("async function observePendingDrafts");
  const monitorEnd = worker.indexOf("// Image security config", monitorStart);
  const monitor = worker.slice(monitorStart, monitorEnd);
  assert.doesNotMatch(monitor, /TRIAGE_QUEUE\.send/);
  assert.match(monitor, /ação explícita no painel/);
});
