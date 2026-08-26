import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("a importação por extensão preserva no run as causas de cada resultado", async () => {
  const [schema, migration, route, report] = await Promise.all([
    read("../db/schema.ts"), read("../drizzle/0033_import_run_details.sql"),
    read("../app/api/collector/import/[sourceId]/route.ts"), read("../app/ImportRunReport.tsx"),
  ]);
  assert.match(schema, /details: text\("details"\)/);
  assert.match(migration, /ADD `details` text/);
  assert.match(route, /const importDetails: ImportDetails/);
  assert.match(route, /invalidReasons: input\.reasons/);
  assert.match(route, /rejectedJobs: filtered\.rejectedJobs/);
  assert.match(route, /details: serializeDetails\(importDetails\)/);
  assert.match(report, /causas registradas/);
  assert.match(report, /Novas \/ atualizadas/);
  assert.match(report, /Rejeitadas pelo perfil/);
  assert.match(report, /Código/);
});
