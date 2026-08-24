import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("toda aprovação segura cria rascunho imediato, sem enviar e-mail", async () => {
  const [run, aiVerdicts, settings, migration, docs] = await Promise.all([
    read("../app/api/triage/run/route.ts"),
    read("../lib/apply-ai-verdict.ts"),
    read("../app/api/admin/settings/route.ts"),
    read("../drizzle/0033_enable_automatic_approved_drafts.sql"),
    read("../README.md"),
  ]);
  assert.match(run, /const draftQueueEnabled = settings\?\.draftQueueEnabled \?\? true/);
  assert.match(run, /if \(draftQueueEnabled && safelyRefined && finalVerdict\.result\.emoji === "✅"/);
  assert.match(run, /if \(autoCreateEnabled && scheduledOutboxIds\.length\)/);
  assert.match(aiVerdicts, /draftQueueEnabled && entry\.verdict === "✅"/);
  assert.match(aiVerdicts, /requestImmediateDraftCreation\(pendingOutboxIds\)/);
  assert.match(settings, /scheduledTriageDraftQueueEnabled:true/);
  assert.match(settings, /scheduledTriageAutoCreateEnabled:true/);
  assert.match(migration, /scheduled_triage_auto_create_enabled` = true/);
  assert.match(docs, /Isso nunca envia e-mails/);
});
