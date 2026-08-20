import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("modelo de triagem é aditivo e preserva histórico, lote e outbox", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0025_triage_batches_history_outbox.sql", import.meta.url), "utf8"),
  ]);
  for (const table of ["triageBatches", "triageHistory", "triageBatchItems", "draftOutbox", "jobAiTriage"]) assert.match(schema, new RegExp(`\\b${table}\\b`));
  for (const table of ["triage_batches", "triage_history", "triage_batch_items", "draft_outbox"]) assert.ok(migration.includes("CREATE TABLE `" + table + "`"));
  assert.match(migration, /CREATE UNIQUE INDEX `draft_outbox_user_job_unique`/);
});
