import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("fila da triagem prioriza ações manuais, recupera atrasos e mantém DLQ", async () => {
  const [config, workflow, queueRoute, worker, ui] = await Promise.all([
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/quality.yml", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(config, /"binding": "TRIAGE_QUEUE"/);
  assert.match(config, /"binding": "MANUAL_TRIAGE_QUEUE"/);
  assert.match(config, /"queue": "radar-carreira-triage-manual"/);
  assert.match(config, /"max_concurrency": 4/);
  assert.match(config, /"dead_letter_queue": "radar-carreira-triage-manual-dlq"/);
  assert.match(config, /"crons": \["\*\/2 \* \* \* \*"\]/);
  assert.match(config, /"queue": "radar-carreira-triage"/);
  assert.match(config, /"queue": "radar-carreira-ai-review"/);
  assert.match(config, /"consumers"/);
  assert.match(config, /"max_batch_size": 1/);
  assert.match(config, /"max_retries": 3/);
  assert.match(config, /"dead_letter_queue": "radar-carreira-triage-dlq"/);
  assert.match(config, /"dead_letter_queue": "radar-carreira-ai-review-dlq"/);
  assert.match(workflow, /wrangler queues create radar-carreira-triage \|\| true/);
  assert.match(workflow, /wrangler queues create radar-carreira-triage-manual \|\| true/);
  assert.match(workflow, /wrangler queues create radar-carreira-triage-manual-dlq \|\| true/);
  assert.match(workflow, /wrangler queues create radar-carreira-triage-dlq \|\| true/);
  assert.match(workflow, /wrangler queues create radar-carreira-ai-review \|\| true/);
  assert.match(queueRoute, /action\?: "resume"/);
  assert.match(queueRoute, /STALE_QUEUE_ITEM_MS/);
  assert.match(queueRoute, /resumePendingBatch/);
  assert.match(queueRoute, /MANUAL_TRIAGE_QUEUE/);
  assert.match(queueRoute, /eq\(triageBatchItems\.status, "processing"\)/);
  assert.match(queueRoute, /lt\(triageBatchItems\.leaseUntil, now\)/);
  assert.match(queueRoute, /set\(\{ status: "queued", leaseOwner: null/);
  assert.match(worker, /try \{/);
  assert.match(worker, /message\.retry\(\{ delaySeconds: 15 \}\)/);
  assert.match(worker, /recoverStalledManualTriage/);
  assert.match(worker, /STALE_MANUAL_TRIAGE_MS = 2 \* 60_000/);
  assert.match(worker, /env\.MANUAL_TRIAGE_QUEUE\.sendBatch/);
  assert.match(worker, /async scheduled/);
  assert.match(ui, /recoverableManualItemCount/);
  assert.match(ui, /Fila em recuperação/);
  assert.match(ui, /fila prioritária/);
});
