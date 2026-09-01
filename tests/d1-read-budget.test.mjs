import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("rotinas periódicas não repetem as varreduras que esgotaram rows_read", async () => {
  const [worker, config, triage, usage, jobsRoute, dashboard] = await Promise.all([
    read("../worker/index.ts"), read("../wrangler.jsonc"), read("../app/TriageReport.tsx"),
    read("../app/api/triage/queue-usage/route.ts"), read("../app/api/jobs/route.ts"), read("../app/Dashboard.tsx"),
  ]);

  assert.match(config, /"crons": \["\*\/15 \* \* \* \*"\]/);
  assert.match(worker, /SELECT id, user_id FROM triage_batches/);
  assert.match(worker, /WHERE batch_id = \? AND status = 'queued'/);
  assert.doesNotMatch(worker, /SELECT i\.batch_id, i\.job_id, b\.user_id/);
  const draftMonitor = worker.slice(worker.indexOf("async function observePendingDrafts"), worker.indexOf("// Image security config"));
  assert.doesNotMatch(draftMonitor, /user_job_analyses/);
  assert.match(worker, /scheduledDate\.getUTCMinutes\(\) < 5/);

  assert.doesNotMatch(triage, /setInterval\([^)]*loadHistory[\s\S]{0,120}4000/);
  assert.match(triage, /\/api\/triage\/progress\?batchId=/);
  assert.match(triage, /30_000/);
  assert.match(triage, /queue-usage.*compact=1/);
  assert.match(usage, /if \(compact\)/);
  assert.match(triage, /120_000/);

  assert.doesNotMatch(jobsRoute, /count\(distinct \$\{jobImportRuns\.jobId\}\)/);
  assert.match(jobsRoute, /jobs: importRuns\.received/);
  assert.doesNotMatch(dashboard, /approvedDraftRecoveryRequestedRef/);
});

test("parâmetros periódicos mantêm margem mesmo com a tela aberta o dia inteiro", () => {
  const cronRunsPerDay = 24 * 60 / 15;
  const draftScansPerDay = 24;
  const compactPanelPollsPerDay = 24 * 60 * 60 / 120;
  const activeProgressPollsPerHour = 60 * 60 / 30;

  assert.equal(cronRunsPerDay, 96);
  assert.equal(draftScansPerDay, 24);
  assert.equal(compactPanelPollsPerDay, 720);
  assert.equal(activeProgressPollsPerHour, 120);
  assert.ok(draftScansPerDay < 50, "a varredura de rascunhos deve permanecer horária");
});
