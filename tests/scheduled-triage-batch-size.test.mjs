import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("o limite da triagem agendada é persistido, configurável e aplicado pelo servidor", async () => {
  const [schema, settings, endpoint, run, worker, migration] = await Promise.all([
    read("../db/schema.ts"), read("../app/AdminSettings.tsx"), read("../app/api/admin/settings/route.ts"),
    read("../app/api/triage/run/route.ts"), read("../worker/index.ts"), read("../drizzle/0039_scheduled_triage_batch_size.sql"),
  ]);
  assert.match(schema, /scheduledTriageBatchSize/);
  assert.match(settings, /Vagas por rodada automática/);
  assert.match(settings, /min="1" max="100"/);
  assert.match(endpoint, /scheduledTriageBatchSize:Math\.max\(1,Math\.min\(100/);
  assert.match(run, /platformSettings\.scheduledTriageBatchSize/);
  assert.match(run, /hasMore: run\.trigger === "schedule"/);
  assert.match(worker, /result\?\.hasMore === true/);
  assert.match(migration, /scheduled_triage_batch_size/);
});
