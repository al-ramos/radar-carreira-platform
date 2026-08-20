import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("triagem nova e consulta de análise são isoladas por usuário e vaga", async () => {
  const [schema, route] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/jobs/[id]/analysis/route.ts", import.meta.url), "utf8"),
  ]);
  for (const table of ["triageBatches", "triageHistory", "draftOutbox"]) {
    const start = schema.indexOf(`export const ${table}`);
    assert.ok(start >= 0);
    assert.match(schema.slice(start, start + 900), /userId: text\("user_id"\)\.notNull\(\)/);
  }
  assert.match(route, /eq\(userJobAnalyses\.userId, user\.userId\)/);
  assert.doesNotMatch(schema, /ALTER TABLE `job_ai_triage`/);
});
