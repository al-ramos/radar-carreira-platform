import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("protege a cota diária e compacta mensagens da triagem manual", async () => {
  const [quota, schema, migration, manual, ai, worker, usageRoute, screen] = await Promise.all([
    readFile(new URL("../lib/queue-quota.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0041_queue_daily_usage.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/queue/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/ai-review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/queue-usage/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(quota, /QUEUE_DAILY_OPERATION_BUDGET = 7_500/);
  assert.match(quota, /QUEUE_OPERATIONS_PER_MESSAGE = 3/);
  assert.match(quota, /reserveQueueMessages/);
  assert.match(schema, /queueDailyUsage/);
  assert.match(migration, /queue_daily_usage/);
  assert.match(manual, /MANUAL_QUEUE_MESSAGE_SIZE = 25/);
  assert.match(manual, /packManualQueueMessages/);
  assert.match(manual, /reserveQueueMessages\(db, "radar-carreira-triage-manual"/);
  assert.match(ai, /CHUNK_SIZE = 10/);
  assert.match(ai, /reserveQueueMessages\(db, "radar-carreira-ai-review"/);
  assert.match(worker, /manual-triage-batch/);
  assert.match(worker, /isRetryableQueueResponse/);
  assert.match(worker, /recordQueueRetry/);
  assert.match(worker, /reserveWorkerQueueMessages/);
  assert.match(worker, /dispatchScheduledTriage/);
  assert.match(worker, /observePendingDrafts/);
  assert.doesNotMatch(worker, /recoverPendingDrafts/);
  assert.match(usageRoute, /queueUsageForToday/);
  assert.match(screen, /Saúde da coleta e triagem/);
});
