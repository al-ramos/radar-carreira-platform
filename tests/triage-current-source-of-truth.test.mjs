import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("contador, fila, executor, histórico e análises usam a mesma triagem vigente", async () => {
  const [helper, preview, queue, run, history, usage, ai, codex, schema, migration] = await Promise.all([
    read("../lib/current-triage.ts"),
    read("../app/api/triage/preview/route.ts"),
    read("../app/api/triage/queue/route.ts"),
    read("../app/api/triage/run/route.ts"),
    read("../app/api/triage/history/route.ts"),
    read("../app/api/triage/queue-usage/route.ts"),
    read("../app/api/triage/ai-review/route.ts"),
    read("../app/api/triage/codex-queue/route.ts"),
    read("../db/schema.ts"),
    read("../drizzle/0047_triage_current_version_index.sql"),
  ]);

  for (const version of ["profileRevision", "rulesRevision", "instructionsRevision"]) assert.match(helper, new RegExp(version));
  assert.match(preview, /hasCurrentTriage\(user\.userId, versions\)/);
  assert.match(queue, /needsCurrentTriage\(user\.userId, versions\)/);
  assert.match(run, /needsCurrentTriage\(userId, versions\)/);
  assert.match(history, /needsCurrentTriage\(user\.userId, versions\)/);
  assert.match(usage, /needsCurrentTriage\(user\.userId, versions\)/);
  assert.match(ai, /needsCurrentTriage\(user\.userId, versions\)/);
  assert.match(codex, /needsCurrentTriage\(auth\.user\.userId, versions\)/);
  assert.match(schema, /triage_history_current_version_idx/);
  assert.match(migration, /profile_revision.*rules_revision.*instructions_revision/s);
});

test("origens automáticas criam rascunho sem autorizar envio", async () => {
  const [run, aiVerdicts, csvImport, jobAnalysis, queue, screen] = await Promise.all([
    read("../app/api/triage/run/route.ts"),
    read("../lib/apply-ai-verdict.ts"),
    read("../app/api/admin/triage-import/route.ts"),
    read("../app/api/jobs/[id]/analysis/route.ts"),
    read("../app/api/triage/drafts/queue/route.ts"),
    read("../app/TriageReport.tsx"),
  ]);
  for (const source of [run, aiVerdicts, csvImport, jobAnalysis]) {
    assert.match(source, /autoSendAuthorized: false, autoSendAuthorizedAt: null/);
  }
  assert.match(queue, /const authorizeAutomaticSend = body\.action === "queue"/);
  assert.match(queue, /existing\.status === "drafted" && authorizeAutomaticSend/);
  assert.match(screen, /O envio só acontece após sua confirmação/);
});
