import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("falha de lote fica visível no histórico pessoal da triagem", async () => {
  const [schema, migration, runRoute, historyRoute, component] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0027_triage_batch_error.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/run/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/triage/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/TriageReport.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /error: text\("error"\)/);
  assert.match(migration, /ADD `error` text/);
  assert.match(runRoute, /error: detail/);
  assert.match(historyRoute, /error: triageBatches\.error/);
  assert.match(component, /Falha registrada:/);
});
