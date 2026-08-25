import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("histórico oferece recuperação segura para lote concluído sem análise visível", async () => {
  const [historyRoute, repairRoute, screen] = await Promise.all([
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/history/repair/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(historyRoute, /recovery: \{ available:/);
  assert.match(repairRoute, /eq\(triageBatchItems\.status, "completed"\)/);
  assert.match(repairRoute, /isNull\(userJobAnalyses\.jobId\)/);
  assert.match(repairRoute, /onConflictDoNothing\(\)/, "não pode sobrescrever uma análise que tenha sido criada em paralelo");
  assert.match(repairRoute, /recoveredFromTriageHistoryId/);
  assert.match(repairRoute, /row\.source === "ai"/, "o refinamento por IA deve prevalecer quando regras e IA têm o mesmo horário");
  assert.doesNotMatch(repairRoute, /draftOutbox|TRIAGE_QUEUE|fetch\(/, "a recuperação não pode criar rascunhos nem reenfileirar vagas");
  assert.match(screen, /\/api\/triage\/history\/repair/);
  assert.match(screen, /Restaurar \$\{historyRecovery\.available\}/);
});
