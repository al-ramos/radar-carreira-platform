import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("prioridade pessoal é persistida sem alterar o estágio da candidatura", async () => {
  const [schema, pipeline, jobsRoute, dashboard, migration] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/pipeline/route.ts"),
    read("app/api/jobs/route.ts"),
    read("app/Dashboard.tsx"),
    read("drizzle/0042_user_job_priority.sql"),
  ]);
  assert.match(schema, /priority: text\("priority", \{ enum: \["must_apply", "high", "watch"\] \}\)/);
  assert.match(migration, /ADD COLUMN `priority` text/);
  assert.match(pipeline, /const VALID_PRIORITIES/);
  assert.match(pipeline, /priority: body\.priority === undefined \? existing\?\.priority \?\? null : body\.priority/);
  assert.match(jobsRoute, /const priorityFilter =/);
  assert.match(jobsRoute, /priority: priorityByJobId\.get\(job\.id\) \?\? null/);
  assert.match(dashboard, /Minha prioridade/);
  assert.match(dashboard, /🔥 Imperdível/);
  assert.match(dashboard, /setJobPriority/);
});
